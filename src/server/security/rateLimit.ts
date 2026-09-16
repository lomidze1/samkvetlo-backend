import type { CollectionSlug, Payload } from 'payload'

export interface RateLimitCheck {
  collection: CollectionSlug
  ipHash: string
  windowMs: number
  max: number
}

/**
 * ADR 0003 §4 / ADR 0014 §2: counts rows of `collection` with this ipHash
 * created within the last `windowMs` — no extra infrastructure, per the
 * ADR's own "counted via the orders table" approach.
 */
export async function isRateLimited(payload: Payload, check: RateLimitCheck): Promise<boolean> {
  const since = new Date(Date.now() - check.windowMs).toISOString()
  const { totalDocs } = await payload.count({
    collection: check.collection,
    where: {
      and: [{ ipHash: { equals: check.ipHash } }, { createdAt: { greater_than_equal: since } }],
    },
    overrideAccess: true,
  })
  return totalDocs >= check.max
}
