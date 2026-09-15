import type { Payload } from 'payload'

import type { PublicDeliveryZone } from '../../shared/contract/deliveryZone'

/**
 * ADR 0015 §2: GET /api/public/delivery-zones — active zones only, ordered
 * by sortOrder then name. (The ADR's "name COLLATE C" tiebreaker is a
 * byte-order sort for exact reproducibility; Payload's `sort` doesn't
 * expose a collation override, so ties fall back to Postgres's default
 * collation — an accepted simplification for the MVP catalog size.)
 */
export async function getPublicDeliveryZones(payload: Payload): Promise<PublicDeliveryZone[]> {
  const { docs } = await payload.find({
    collection: 'delivery-zones',
    where: { active: { equals: true } },
    overrideAccess: false,
    depth: 0,
    limit: 0,
    sort: ['sortOrder', 'name'],
  })

  return docs
    .filter((doc) => Boolean(doc.slug))
    .map((doc) => ({
      slug: doc.slug as string,
      name: doc.name,
      examples: doc.examples ?? null,
      feeGel: doc.feeGel,
    }))
}
