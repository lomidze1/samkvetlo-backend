/**
 * ADR 0004 §6: prices are never formatted with `Intl` currency (result
 * differs across runtimes/ICU data). Thousands are grouped with U+00A0
 * (non-breaking space) and the same NBSP separates the number from `₾`.
 * Kept identical to samkvetlo/src/lib/format.ts so an order total reads
 * the same in an owner email/SMS as it does on the storefront.
 */
export function formatGel(amountGel: number): string {
  const rounded = Math.round(amountGel)
  const grouped = Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const sign = rounded < 0 ? '-' : ''
  return `${sign}${grouped} ₾`
}
