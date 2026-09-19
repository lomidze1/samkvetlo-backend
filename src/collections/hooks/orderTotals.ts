import type { CollectionBeforeChangeHook } from 'payload'

interface OrderItemInput {
  priceOnConfirmation?: number | null
  qty?: number | null
  unitPrice?: number | null
  [key: string]: unknown
}

/**
 * ADR 0003 §4.5 / ADR 0015 §4: lineTotal, itemsTotalGel and totalGel are
 * always derived from items[]/deliveryFeeGel — recomputed on every save so
 * a client-supplied value for any of them is simply overwritten rather than
 * trusted (deliveryFeeGel itself is a frozen snapshot, locked separately by
 * field access — see Orders.ts).
 */
export const computeOrderTotals: CollectionBeforeChangeHook = ({ data, req }) => {
  if (!data) return data

  // ADR 0014 §12 / T5.12: an anonymization update only ever touches PII
  // text fields, never `items`/`deliveryFeeGel` — without this guard,
  // `data.items` would be `undefined` on that partial update and get
  // recomputed to `[]`, wiping the frozen line-item/total snapshot the
  // retention rule is explicitly required to leave untouched.
  if (req.context?.anonymizing) return data

  const items = ((data.items ?? []) as OrderItemInput[]).map((item) => {
    const unitPrice = item.unitPrice ?? 0
    const qty = item.qty ?? 0
    return {
      ...item,
      priceOnConfirmation: item.priceOnConfirmation ?? unitPrice,
      lineTotal: unitPrice * qty,
    }
  })

  const itemsTotalGel = items.reduce((sum, item) => sum + (item.lineTotal as number), 0)
  const deliveryFeeGel = data.deliveryFeeGel ?? 0

  return { ...data, items, itemsTotalGel, totalGel: itemsTotalGel + deliveryFeeGel }
}
