import type { CollectionAfterChangeHook } from 'payload'

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

  await req.payload.create({
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
  })

  return doc
}
