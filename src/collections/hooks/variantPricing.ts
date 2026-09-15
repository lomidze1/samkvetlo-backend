import type {
  CollectionAfterChangeHook,
  CollectionAfterDeleteHook,
  CollectionBeforeChangeHook,
  Payload,
  PayloadRequest,
} from 'payload'

/** Shared by the variant-triggered recompute and the Products beforeChange hook below. */
async function computeProductPricing(
  payload: Payload,
  productId: number | string,
  req?: PayloadRequest,
): Promise<{ minPrice: number | null; isPurchasable: boolean }> {
  const { docs } = await payload.find({
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
  return { minPrice, isPurchasable: minPrice !== null }
}

/**
 * ADR 0002 §5: Product.minPrice/isPurchasable are denormalized from its
 * variants, so the catalog can sort/filter by price without a join. A
 * variant only counts once it has a price and is approved (or was approved
 * and is now needs-review — the old price still shows on the site, D8).
 *
 * Takes `payload` rather than a hook's `req` so it can also be called from a
 * standalone script (seed.ts) to self-heal a product whose denormalized
 * columns drifted from its variants — e.g. a seed run that was interrupted
 * between approving a variant and this recompute. `req` is optional and,
 * when passed, keeps the call inside the same request/transaction as a hook.
 */
export async function recomputeProductPricing(
  payload: Payload,
  productId: number | string,
  req?: PayloadRequest,
): Promise<void> {
  const data = await computeProductPricing(payload, productId, req)

  // Not payload.update(): products has versions/drafts, and update() reads
  // the *latest* version (which may be an unpublished draft) as its base,
  // then — since this call passes no `draft: true` — writes that base back
  // out as the published document. On a published product with a pending
  // draft edit, that silently publishes (or merges in) the draft (code
  // review finding on T1.1–T1.8). db.updateOne() writes straight to the
  // products table row by id — no version read/merge, no hooks — so it only
  // ever touches these two denormalized columns, and only the *live* row.
  await payload.db.updateOne({ collection: 'products', id: productId, data, req })
}

/**
 * Code review (Phase 2): the live-row write above never touched
 * `_products_v`. Every *other* write to a product — a draft autosave, then
 * publishing it — builds a brand new version from `data` plus each field's
 * own `defaultValue` for anything `data` doesn't include, not from the
 * previous version's values. Since minPrice/isPurchasable are readOnly
 * fields the admin form never resubmits, that reset them to
 * null/false on the very next save, wiping out an already-approved price.
 * Recomputing them here, on every create/update, makes them self-correcting
 * on every write instead of relying on the one write that happened to
 * approve a price.
 */
export const recomputeProductPricingBeforeChange: CollectionBeforeChangeHook = async ({
  data,
  originalDoc,
  operation,
  req,
}) => {
  if (operation !== 'update' || !originalDoc) return data
  const pricing = await computeProductPricing(req.payload, (originalDoc as { id: number | string }).id, req)
  return { ...data, ...pricing }
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
  if (productId !== undefined) await recomputeProductPricing(req.payload, productId, req)
  return doc
}

export const recomputeProductPricingAfterDelete: CollectionAfterDeleteHook = async ({
  doc,
  req,
}) => {
  const productId = productIdOf(doc.product)
  if (productId !== undefined) await recomputeProductPricing(req.payload, productId, req)
  return doc
}
