import type { Payload } from 'payload'
import * as Sentry from '@sentry/nextjs'

import { ka } from '../../i18n/ka'
import { getEmailSender } from '../notify'

export interface RecomputeResult {
  autoApplied: number
  needsReview: number
}

function idOf(value: unknown): number | string | undefined {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    return (value as { id: number | string }).id
  }
  return undefined
}

/**
 * ADR 0006 (rate refresh + needs-review): called after a new exchange-rate
 * row is written (cron endpoint / rates:sync script).
 * Recomputes every costing against the latest rate; for a variant with a
 * live price (approved/needs-review) whose suggested price now differs by
 * more than pricing-settings.needsReviewPct:
 *   - autoPricing + pConfirmed -> the price changes automatically
 *     (priceHistory entry with auto: true)
 *   - otherwise -> priceStatus becomes 'needs-review' (site price unchanged)
 *     and the owner gets one digest email listing every such variant.
 */
export async function recomputeCostingsForNewRate(payload: Payload): Promise<RecomputeResult> {
  const settings = await payload.findGlobal({ slug: 'pricing-settings', overrideAccess: true })
  const { docs: costings } = await payload.find({
    collection: 'costings',
    depth: 0,
    limit: 0,
    overrideAccess: true,
  })

  let autoApplied = 0
  const reviewLines: string[] = []

  for (const costing of costings) {
    const variantId = idOf(costing.variant)
    if (variantId === undefined) continue

    const variant = await payload.findByID({
      collection: 'variants',
      id: variantId,
      depth: 0,
      overrideAccess: true,
    })

    // Recompute the costing's derived fields (C, suggested price, indicator)
    // against the latest rate. computeCostingFields (beforeChange) does the
    // math; passing {} keeps every input field at its current value.
    const updated = await payload.update({
      collection: 'costings',
      id: costing.id,
      data: {},
      overrideAccess: true,
    })

    if (variant.priceStatus !== 'approved' && variant.priceStatus !== 'needs-review') continue
    if (typeof variant.price !== 'number' || variant.price <= 0) continue
    if (typeof updated.suggestedPriceGel !== 'number') continue
    const suggested = updated.suggestedPriceGel

    const diffPct = (Math.abs(suggested - variant.price) / variant.price) * 100
    if (diffPct <= settings.needsReviewPct) continue

    if (costing.autoPricing && settings.pConfirmed) {
      await payload.update({
        collection: 'variants',
        id: variant.id,
        data: { price: suggested, priceStatus: 'approved' },
        overrideAccess: true,
      })
      await payload.update({
        collection: 'costings',
        id: costing.id,
        data: {
          proposedPriceGel: suggested,
          priceHistory: [
            ...(updated.priceHistory ?? []),
            {
              from: variant.price,
              to: suggested,
              at: new Date().toISOString(),
              rateDate: updated.rateDate,
              auto: true,
            },
          ],
        },
        overrideAccess: true,
      })
      autoApplied += 1
    } else {
      await payload.update({
        collection: 'variants',
        id: variant.id,
        data: { priceStatus: 'needs-review' },
        overrideAccess: true,
      })
      reviewLines.push(ka.server.pricing.needsReviewLine(variant.sku ?? String(variant.id), variant.price, suggested))
    }
  }

  if (reviewLines.length > 0) {
    const siteSettings = await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })
    const ownerEmails = (siteSettings.ownerEmails ?? [])
      .map((entry) => entry.email)
      .filter((email): email is string => Boolean(email))
    if (ownerEmails.length > 0) {
      // ADR 0019 §7: prices are already written to needs-review above, so a
      // real adapter failure here must not fail the cron/script that called
      // us — log it and tell Sentry (name/code only, no PII) instead.
      try {
        await getEmailSender().send({
          to: ownerEmails,
          subject: ka.server.pricing.needsReviewSubject,
          text: reviewLines.join('\n'),
        })
      } catch (err) {
        const name = err instanceof Error ? err.name : 'Error'
        const withCode = err as { code?: number | string }
        const code = typeof withCode?.code === 'string' || typeof withCode?.code === 'number' ? withCode.code : undefined
        payload.logger.error({ err }, 'notification failed: email')
        Sentry.captureMessage('notification failed: email', {
          level: 'warning',
          extra: { channel: 'email', name, ...(code !== undefined ? { code } : {}) },
        })
      }
    }
  }

  return { autoApplied, needsReview: reviewLines.length }
}
