import type { CollectionAfterChangeHook, CollectionAfterDeleteHook } from 'payload'

/**
 * ADR 0002 §5: Product.minPrice/isPurchasable are denormalized from its
 * variants, so the catalog can sort/filter by price without a join. A
 * variant only counts once it has a price and is approved (or was approved
 * and is now needs-review — the old price still shows on the site, D8).
 */
async function recomputeProductPricing(
  productId: number | string,
  req: Parameters<CollectionAfterChangeHook>[0]['req'],
): Promise<void> {
  const { docs } = await req.payload.find({
    collection: 'variants',
    where: {
      product: { equals: productId },
      priceStatus: { in: ['approved', 'needs-review'] },
    },
    limit: 0,
    depth: 0,
    req,
  })

  const prices = docs
    .map((doc) => doc.price)
    .filter((price): price is number => typeof price === 'number')
  const minPrice = prices.length > 0 ? Math.min(...prices) : null

  await req.payload.update({
    collection: 'products',
    id: productId,
    data: { minPrice, isPurchasable: minPrice !== null },
    req,
    overrideAccess: true,
  })
}

function productIdOf(value: unknown): number | string | undefined {
  if (typeof value === 'number' || typeof value === 'string') return value
  if (value && typeof value === 'object' && 'id' in value) {
    return (value as { id: number | string }).id
  }
  return undefined
}

export const recomputeProductPricingAfterChange: CollectionAfterChangeHook = async ({
  doc,
  req,
}) => {
  const productId = productIdOf(doc.product)
  if (productId !== undefined) await recomputeProductPricing(productId, req)
  return doc
}

export const recomputeProductPricingAfterDelete: CollectionAfterDeleteHook = async ({
  doc,
  req,
}) => {
  const productId = productIdOf(doc.product)
  if (productId !== undefined) await recomputeProductPricing(productId, req)
  return doc
}
