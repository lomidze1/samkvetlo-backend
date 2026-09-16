import type { Payload } from 'payload'

import type { CartQuote, CartQuoteInput } from '../../shared/contract/cart'
import { PublicHttpError } from '../../endpoints/public/publicEndpoint'
import { getActiveDeliveryZoneBySlug } from '../public/deliveryZones'
import { repriceCartLines } from './repriceLines'

/**
 * T3.1 (ADR 0003 §2 / ADR 0015 §3): every line is re-priced from the DB —
 * a client-supplied price in localStorage never affects the result. The
 * delivery fee is added once per order, never per line.
 */
export async function quoteCart(payload: Payload, input: CartQuoteInput): Promise<CartQuote> {
  let deliveryFeeGel: number | null = null
  if (input.deliveryZone !== undefined) {
    const zone = await getActiveDeliveryZoneBySlug(payload, input.deliveryZone)
    if (!zone) throw new PublicHttpError(400, 'err.deliveryZone.invalid')
    deliveryFeeGel = zone.feeGel
  }

  const repriced = await repriceCartLines(payload, input.lines)
  const itemsTotalGel = repriced.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0)

  return {
    lines: repriced.map((line) => ({
      variantId: line.variantId,
      configurationId: line.configurationId,
      qty: line.qty,
      productSlug: line.productSlug,
      productTitle: line.productTitle,
      thumbnail: line.thumbnail,
      variantTitle: line.variantTitle,
      availability: line.availability,
      leadTimeText: line.leadTimeText,
      unitPrice: line.unitPrice,
      lineTotal: line.lineTotal,
      available: line.available,
    })),
    itemsTotalGel,
    deliveryFeeGel,
    totalGel: itemsTotalGel + (deliveryFeeGel ?? 0),
  }
}
