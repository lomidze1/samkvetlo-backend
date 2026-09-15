import type { CollectionAfterChangeHook } from 'payload'

/**
 * ADR 0002 §2: our own public SKU (SMK-000123), auto-generated — the
 * supplier's article number is never stored here (ADR 0005).
 *
 * Code review fix (T1.1–T1.8): this used to be `count()+1` in a
 * beforeValidate hook, which collides after a delete (count drops back
 * down) or under concurrent creates (two requests read the same count
 * before either inserts). The row's own primary key (`variants_id_seq`,
 * a real Postgres sequence Payload owns and manages as part of its schema)
 * is already exactly the monotonic, gap-tolerant, collision-proof counter
 * this needs — so this now runs afterChange (once `doc.id` exists) and
 * writes straight to the row via db.updateOne, bypassing hooks so it can't
 * recurse into itself.
 */
export const generateVariantSku: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  if (operation !== 'create' || doc.sku) return doc

  const sku = `SMK-${String(doc.id).padStart(6, '0')}`
  await req.payload.db.updateOne({ collection: 'variants', id: doc.id, data: { sku }, req })
  return { ...doc, sku }
}
