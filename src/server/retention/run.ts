import type { Payload } from 'payload'

import { ka } from '../../i18n/ka'
import { getEmailSender } from '../notify'
import { anonymizeCustomRequest, anonymizeOrder, ORDER_ANONYMIZE_EXEMPT_STATUSES } from './anonymize'

const DAY_MS = 24 * 60 * 60 * 1000
const IP_HASH_RETENTION_MS = 30 * DAY_MS
const SHARE_LINK_GRACE_MS = 30 * DAY_MS
const DEFAULT_RETENTION_YEARS = 2

export interface RetentionResult {
  ipHashCleared: number
  shareLinksDeleted: number
  ordersAnonymized: number
  ordersSkippedOpen: number
  customRequestsAnonymized: number
}

type IpHashCollection = 'orders' | 'custom-requests' | 'share-links'

/** `ipHash` (orders, custom-requests, share-links) -> null, 30 days after creation. */
async function clearOldIpHashes(payload: Payload, collection: IpHashCollection): Promise<number> {
  const cutoff = new Date(Date.now() - IP_HASH_RETENTION_MS).toISOString()
  const { docs } = await payload.find({
    collection,
    where: { createdAt: { less_than: cutoff } },
    limit: 0,
    depth: 0,
    overrideAccess: true,
  })

  let cleared = 0
  for (const doc of docs) {
    if (!doc.ipHash) continue
    await payload.update({ collection, id: doc.id, data: { ipHash: null }, overrideAccess: true })
    cleared += 1
  }
  return cleared
}

/** share-links, `expiresAt` + 30 days -> deleted (no PII, just cart/config refs + hashes). */
async function deleteExpiredShareLinks(payload: Payload): Promise<number> {
  const cutoff = new Date(Date.now() - SHARE_LINK_GRACE_MS).toISOString()
  const { docs } = await payload.find({
    collection: 'share-links',
    where: { expiresAt: { less_than: cutoff } },
    limit: 0,
    depth: 0,
    overrideAccess: true,
  })
  for (const doc of docs) {
    await payload.delete({ collection: 'share-links', id: doc.id, overrideAccess: true })
  }
  return docs.length
}

/**
 * orders, `statusChangedAt` + retentionYears -> anonymized, except the
 * three "open financial obligation" statuses, which are only counted for
 * the digest email.
 */
async function anonymizeOldOrders(payload: Payload, retentionYears: number): Promise<{ anonymized: number; skippedLines: string[] }> {
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - retentionYears)

  const { docs } = await payload.find({
    collection: 'orders',
    where: { and: [{ statusChangedAt: { less_than: cutoff.toISOString() } }, { anonymizedAt: { exists: false } }] },
    limit: 0,
    depth: 0,
    overrideAccess: true,
  })

  let anonymized = 0
  const skippedLines: string[] = []
  for (const order of docs) {
    if (order.anonymizedAt) continue
    if ((ORDER_ANONYMIZE_EXEMPT_STATUSES as readonly string[]).includes(order.status)) {
      skippedLines.push(ka.server.retention.openOrdersDigestLine(order.number ?? String(order.id), order.status))
      continue
    }
    await anonymizeOrder(payload, order)
    anonymized += 1
  }
  return { anonymized, skippedLines }
}

/** custom-requests, `statusChangedAt` + retentionYears -> anonymized (no status is exempt). */
async function anonymizeOldCustomRequests(payload: Payload, retentionYears: number): Promise<number> {
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - retentionYears)

  const { docs } = await payload.find({
    collection: 'custom-requests',
    where: { and: [{ statusChangedAt: { less_than: cutoff.toISOString() } }, { anonymizedAt: { exists: false } }] },
    limit: 0,
    depth: 0,
    overrideAccess: true,
  })

  let anonymized = 0
  for (const request of docs) {
    if (request.anonymizedAt) continue
    await anonymizeCustomRequest(payload, request)
    anonymized += 1
  }
  return anonymized
}

/**
 * ADR 0014 §12 (D25) / T5.12: the one function behind `GET
 * /api/cron/retention`. Every rule is independent and only ever narrows to
 * the rows it names — a failure in one rule (thrown, not caught here) still
 * leaves the ones that already ran committed, since each is its own
 * Local API call with no shared transaction. Idempotent: a second run
 * back-to-back finds nothing left to do and returns all zeros.
 */
export async function runRetention(payload: Payload): Promise<RetentionResult> {
  const siteSettings = await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })
  const retentionYears = siteSettings.retentionYears ?? DEFAULT_RETENTION_YEARS

  const ipHashCleared =
    (await clearOldIpHashes(payload, 'orders')) +
    (await clearOldIpHashes(payload, 'custom-requests')) +
    (await clearOldIpHashes(payload, 'share-links'))

  const shareLinksDeleted = await deleteExpiredShareLinks(payload)

  const { anonymized: ordersAnonymized, skippedLines } = await anonymizeOldOrders(payload, retentionYears)
  const customRequestsAnonymized = await anonymizeOldCustomRequests(payload, retentionYears)

  if (skippedLines.length > 0) {
    const ownerEmails = (siteSettings.ownerEmails ?? [])
      .map((entry) => entry.email)
      .filter((email): email is string => Boolean(email))
    if (ownerEmails.length > 0) {
      await getEmailSender().send({
        to: ownerEmails,
        subject: ka.server.retention.openOrdersDigestSubject(skippedLines.length),
        text: skippedLines.join('\n'),
      })
    }
  }

  // ADR 0014 §12: only counts in the log, never PII.
  const result: RetentionResult = {
    ipHashCleared,
    shareLinksDeleted,
    ordersAnonymized,
    ordersSkippedOpen: skippedLines.length,
    customRequestsAnonymized,
  }
  payload.logger.info(result, 'retention: done')
  return result
}
