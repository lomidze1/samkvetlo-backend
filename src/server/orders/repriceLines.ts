import type { Payload } from 'payload'

import type { Product } from '../../payload-types'
import type { CartLineInput } from '../../shared/contract/cart'
import type { PublicImage } from '../../shared/contract/image'
import { isPriceLive } from '../public/product'
import { toPublicImage } from '../public/image'

/**
 * Internal, richer sibling of CartQuoteLine (adds `sku`, needed for the
 * Order snapshot but not exposed to the public cart DTO). Shared by
 * quoteCart (T3.1) and submitOrder (T3.3) so "is this line purchasable"
 * has exactly one definition (chief-architect note).
 *
 * A variant that doesn't exist (or belongs to an unpublished product,
 * which `overrideAccess: false` already filters out) yields a minimal
 * line: `available: false` and no product/variant data at all. A variant
 * that exists but isn't purchasable right now (price not live, or the
 * line carries a configurationId — Phase 4) still carries its public
 * product data, just with `available: false` and null pricing.
 */
export interface RepricedLine {
  variantId: number
  configurationId: string | null
  qty: number
  productSlug: string | null
  productTitle: string | null
  thumbnail: PublicImage | null
  variantTitle: string | null
  sku: string | null
  availability: 'ready' | 'made-to-order' | null
  leadTimeText: string | null
  unitPrice: number | null
  lineTotal: number | null
  available: boolean
}

export async function repriceCartLines(payload: Payload, lines: CartLineInput[]): Promise<RepricedLine[]> {
  const variantIds = [...new Set(lines.map((line) => line.variantId))]

  const { docs: variants } =
    variantIds.length > 0
      ? await payload.find({
          collection: 'variants',
          where: { id: { in: variantIds } },
          depth: 2,
          limit: 0,
          overrideAccess: false,
        })
      : { docs: [] }

  const variantById = new Map(variants.map((variant) => [variant.id, variant]))

  return lines.map((line) => {
    const variant = variantById.get(line.variantId)
    if (!variant) {
      return {
        variantId: line.variantId,
        configurationId: line.configurationId ?? null,
        qty: line.qty,
        productSlug: null,
        productTitle: null,
        thumbnail: null,
        variantTitle: null,
        sku: null,
        availability: null,
        leadTimeText: null,
        unitPrice: null,
        lineTotal: null,
        available: false,
      }
    }

    const product = typeof variant.product === 'object' ? (variant.product as Product) : null
    const thumbnail = product
      ? toPublicImage(Array.isArray(product.gallery) ? (product.gallery[0] ?? null) : null)
      : null

    // T4.9 (not built yet): a configurationId line is unavailable for now.
    const available = !line.configurationId && isPriceLive(variant)
    const unitPrice = available ? (variant.price as number) : null
    const lineTotal = available ? unitPrice! * line.qty : null

    return {
      variantId: line.variantId,
      configurationId: line.configurationId ?? null,
      qty: line.qty,
      productSlug: product?.slug ?? null,
      productTitle: product?.title ?? null,
      thumbnail,
      variantTitle: variant.title,
      sku: variant.sku ?? null,
      availability: variant.availability,
      leadTimeText: variant.leadTimeText ?? null,
      unitPrice,
      lineTotal,
      available,
    }
  })
}
