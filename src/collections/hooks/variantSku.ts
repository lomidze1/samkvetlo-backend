import type { CollectionBeforeValidateHook } from 'payload'

/**
 * ADR 0002 §2: our own public SKU (SMK-000123), auto-generated — the
 * supplier's article number is never stored here (ADR 0005).
 */
export const generateVariantSku: CollectionBeforeValidateHook = async ({
  data,
  operation,
  req,
}) => {
  if (operation !== 'create' || !data) return data

  const { totalDocs } = await req.payload.count({ collection: 'variants', req })
  const sku = `SMK-${String(totalDocs + 1).padStart(6, '0')}`
  return { ...data, sku }
}
