import type { Access } from 'payload'

/**
 * `variants` has no `_status` of its own, but each one belongs to a
 * `product` that does. Without this, an anonymous request to Payload's own
 * REST (`/api/variants`) would reveal the title/price/SKU of variants
 * belonging to a still-draft (unannounced) product — see
 * publicReadPublished.ts for the matching products/portfolio fix.
 */
export const publicReadVariantOfPublishedProduct: Access = async ({ req }) => {
  if (req.user) return true

  const { docs } = await req.payload.find({
    collection: 'products',
    where: { _status: { equals: 'published' } },
    limit: 0,
    depth: 0,
    overrideAccess: true,
    req,
  })

  // Always a Where (never boolean `false`): an empty `in: []` legitimately
  // matches zero rows, whereas returning `false` here makes Payload's
  // find() throw Forbidden instead of yielding an empty result set.
  const publishedProductIds = docs.map((doc) => doc.id)
  return { product: { in: publishedProductIds } }
}
