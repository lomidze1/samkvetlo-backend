import type { CollectionAfterChangeHook } from 'payload'

import { withRevalidateSkipped } from '../../server/revalidate/withRevalidateSkipped'

/**
 * ADR 0002 §4/§35: every product needs ≥ 1 variant (the variant picker only
 * shows up when there's more than one), so a new product gets a default
 * "სტანდარტული" variant automatically. The owner edits or adds more later.
 */
export const createDefaultVariant: CollectionAfterChangeHook = async ({
  doc,
  operation,
  req,
}) => {
  if (operation !== 'create') return doc

  // Code review fix: without this, creating a product sent 2 revalidate
  // requests — one from this hook's own nested variant create (Variants'
  // afterChange also revalidates ['catalog']), one from the product's own
  // afterChange right after. The product's revalidate below covers both.
  await withRevalidateSkipped(req, () =>
    req.payload.create({
      collection: 'variants',
      data: {
        product: doc.id,
        title: 'სტანდარტული',
        coating: 'none',
        sortOrder: 0,
        availability: 'ready',
        priceStatus: 'draft',
      },
      req,
      overrideAccess: true,
    }),
  )

  return doc
}
