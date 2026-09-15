import type { CollectionAfterChangeHook } from 'payload'

/**
 * ADR 0003 §6: our own order number "SMK-{YYYY}-{000123}". Same trick as
 * generateVariantSku (afterChange + the row's own primary key) — see that
 * file's comment for why this isn't count()+1 anymore (code review fix,
 * T1.1–T1.8).
 */
export const generateOrderNumber: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  if (operation !== 'create' || doc.number) return doc

  const year = new Date().getFullYear()
  const number = `SMK-${year}-${String(doc.id).padStart(6, '0')}`
  await req.payload.db.updateOne({ collection: 'orders', id: doc.id, data: { number }, req })
  return { ...doc, number }
}
