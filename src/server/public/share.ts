import type { Payload } from 'payload'

import type { PublicShareDTO } from '../../shared/contract/shareLink'
import { repriceCartLines } from '../orders/repriceLines'
import { hashToken } from '../share/token'

/**
 * GET /api/public/share/:token (ADR 0011 §1). This is the ONE deliberate,
 * narrow `overrideAccess: true` lookup in the public data layer (task
 * instruction / ADR 0005 layer 3 exception): `share-links` is admin-only
 * (ADR 0005 layer 1), but a valid 43-char token *is* the credential for an
 * anonymous read here — there is no other way to authorize it. Scoped as
 * tightly as possible: exact tokenHash match only, depth: 0, no other
 * field read from the row is ever spread into the DTO below. Every other
 * src/server/public/* function uses overrideAccess: false.
 *
 * Expired, revoked and unknown tokens all resolve to `null` (-> the
 * endpoint's identical 404) — no oracle for guessing a live token.
 */
export async function getPublicShareByToken(payload: Payload, token: string): Promise<PublicShareDTO | null> {
  const { docs } = await payload.find({
    collection: 'share-links',
    where: { tokenHash: { equals: hashToken(token) } },
    limit: 1,
    depth: 0,
    overrideAccess: true,
  })
  const doc = docs[0]
  if (!doc) return null
  if (doc.revokedAt) return null
  if (new Date(doc.expiresAt).getTime() <= Date.now()) return null

  await payload
    .update({
      collection: 'share-links',
      id: doc.id,
      data: { viewCount: (doc.viewCount ?? 0) + 1 },
      overrideAccess: true,
    })
    .catch((err: unknown) => {
      payload.logger.error({ err, shareLinkId: doc.id }, 'getPublicShareByToken: failed to persist viewCount')
    })

  const lines = await repriceCartLines(
    payload,
    (doc.cartLines ?? []).map((line) => ({
      variantId: line.variantId,
      qty: line.qty,
      configurationId: line.configurationId ?? undefined,
    })),
  )

  return {
    kind: 'cart',
    lines: lines.map((line) => ({
      variantId: line.variantId,
      configurationId: line.configurationId,
      qty: line.qty,
      productSlug: line.productSlug,
      productTitle: line.productTitle,
      thumbnail: line.thumbnail,
      variantTitle: line.variantTitle,
      availability: line.availability,
      leadTimeText: line.leadTimeText,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      available: line.available,
    })),
    itemsTotalGel: lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0),
    expiresAt: doc.expiresAt,
  }
}
