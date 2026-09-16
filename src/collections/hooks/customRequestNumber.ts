import type { CollectionAfterChangeHook } from 'payload'

/**
 * ADR 0011 §3: "REQ-{YYYY}-{000123}" — same trick as generateOrderNumber
 * (afterChange + the row's own primary key), see that file's comment.
 */
export const generateCustomRequestNumber: CollectionAfterChangeHook = async ({ doc, operation, req }) => {
  if (operation !== 'create' || doc.number) return doc

  const year = new Date().getFullYear()
  const number = `REQ-${year}-${String(doc.id).padStart(6, '0')}`
  await req.payload.db.updateOne({ collection: 'custom-requests', id: doc.id, data: { number }, req })
  return { ...doc, number }
}
