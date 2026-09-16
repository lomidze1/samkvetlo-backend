'use client'

import { useRowLabel } from '@payloadcms/ui'

interface OrderItemRow {
  productTitle?: string
  variantTitle?: string
  sku?: string
  unitPrice?: number
  qty?: number
  lineTotal?: number
  patriarchateLetter?: { received?: boolean | null }
}

// Line items are frozen snapshots (ADR 0003 §4.5) — collapsed by default in
// the admin, so the row label must carry enough to identify the line
// without expanding it: product/variant, sku, qty × price and whether the
// patriarchate letter (D15) arrived.
export function OrderItemRowLabel() {
  const { data, rowNumber } = useRowLabel<OrderItemRow>()

  const title = data?.productTitle || `ხაზი ${(rowNumber ?? 0) + 1}`
  const variant = data?.variantTitle ? ` — ${data.variantTitle}` : ''
  const sku = data?.sku ? ` · ${data.sku}` : ''
  const qtyPrice =
    typeof data?.qty === 'number' && typeof data?.unitPrice === 'number'
      ? ` · ${data.qty} × ${data.unitPrice} ₾`
      : ''
  const total = typeof data?.lineTotal === 'number' ? ` = ${data.lineTotal} ₾` : ''
  const letter = data?.patriarchateLetter?.received ? ' · წერილი ✓' : ''

  return (
    <span>
      {title}
      {variant}
      {sku}
      {qtyPrice}
      {total}
      {letter}
    </span>
  )
}
