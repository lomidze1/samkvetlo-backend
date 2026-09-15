import type { CollectionBeforeValidateHook } from 'payload'

/**
 * ADR 0003 §6: our own order number "SMK-{YYYY}-{000123}". Same trick as
 * generateVariantSku (beforeValidate + a count), so it's available on the
 * doc that gets inserted rather than needing a second update afterwards.
 */
export const generateOrderNumber: CollectionBeforeValidateHook = async ({ data, operation, req }) => {
  if (operation !== 'create' || !data || data.number) return data

  const { totalDocs } = await req.payload.count({ collection: 'orders', req })
  const year = new Date().getFullYear()
  const number = `SMK-${year}-${String(totalDocs + 1).padStart(6, '0')}`
  return { ...data, number }
}
