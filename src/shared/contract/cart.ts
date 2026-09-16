// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012 §3, ADR 0015)
import { z } from 'zod'

import { PublicImageSchema } from './image'
import { AVAILABILITY_VALUES } from './product'

// ADR 0014 §5: cart <= 30 lines, qty 1-20.
export const CartLineInputSchema = z.strictObject({
  variantId: z.number().int().positive(),
  qty: z.number().int().min(1).max(20),
  // T4.9 (not built yet): a line with a configurationId is quoted as
  // unavailable for now (Configurations collection arrives in Phase 4).
  configurationId: z.string().min(1).optional(),
})
export type CartLineInput = z.infer<typeof CartLineInputSchema>

export const CartQuoteInputSchema = z.strictObject({
  lines: z.array(CartLineInputSchema).min(1).max(30),
  deliveryZone: z.string().min(1).optional(),
})
export type CartQuoteInput = z.infer<typeof CartQuoteInputSchema>

/**
 * ADR 0015 §3: only public data the cart UI needs — no supplier/cost
 * fields (ADR 0005). An unavailable line (unknown variant, no live price,
 * or carrying a configurationId) has `available: false` and null pricing;
 * quoteCart excludes it from `itemsTotalGel`.
 */
export const CartQuoteLineSchema = z.strictObject({
  variantId: z.number().int().positive(),
  configurationId: z.string().nullable(),
  qty: z.number().int(),
  productSlug: z.string().nullable(),
  productTitle: z.string().nullable(),
  thumbnail: PublicImageSchema.nullable(),
  variantTitle: z.string().nullable(),
  availability: z.enum(AVAILABILITY_VALUES).nullable(),
  leadTimeText: z.string().nullable(),
  unitPrice: z.number().nullable(),
  lineTotal: z.number().nullable(),
  available: z.boolean(),
})
export type CartQuoteLine = z.infer<typeof CartQuoteLineSchema>

export const CartQuoteSchema = z.strictObject({
  lines: z.array(CartQuoteLineSchema),
  itemsTotalGel: z.number(),
  deliveryFeeGel: z.number().int().nonnegative().nullable(),
  totalGel: z.number(),
})
export type CartQuote = z.infer<typeof CartQuoteSchema>
