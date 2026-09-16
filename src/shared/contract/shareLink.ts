// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0011 §1, ADR 0012 §3, ADR 0014 §13)
import { z } from 'zod'

import { CartLineInputSchema, CartQuoteLineSchema } from './cart'

// T3.8 only implements `kind: 'cart'` — `configuration` (T4.10, Phase 4)
// isn't built yet (the `configurations` collection doesn't exist). The
// create endpoint rejects any other value with a plain zod error.
export const ShareLinkCreateInputSchema = z.strictObject({
  kind: z.literal('cart', { error: 'required' }),
  cartLines: z.array(CartLineInputSchema).min(1, 'required').max(30, 'tooLong'),
})
export type ShareLinkCreateInput = z.infer<typeof ShareLinkCreateInputSchema>

// ADR 0012 §3 table: POST /api/public/share-links -> { token, ownerSecret,
// expiresAt }. The frontend builds the /s/{token} URL itself and keeps
// ownerSecret in the creator's localStorage (ADR 0011 §1).
export const ShareLinkCreateResultSchema = z.strictObject({
  token: z.string(),
  ownerSecret: z.string(),
  expiresAt: z.string(),
})
export type ShareLinkCreateResult = z.infer<typeof ShareLinkCreateResultSchema>

// `ownerSecret` is optional at the schema level on purpose (task/plan T3.8:
// "revoke without ownerSecret -> 403", not a 400 validation error) — a
// missing or wrong secret both fail revokeShareLink's constant-time
// comparison the same way, so both produce the identical 403.
export const ShareLinkRevokeInputSchema = z.strictObject({
  token: z.string({ error: 'required' }).min(1, 'required'),
  ownerSecret: z.string().optional(),
})
export type ShareLinkRevokeInput = z.infer<typeof ShareLinkRevokeInputSchema>

export const ShareLinkRevokeResultSchema = z.strictObject({
  ok: z.literal(true),
})
export type ShareLinkRevokeResult = z.infer<typeof ShareLinkRevokeResultSchema>

// GET /api/public/share/:token — ADR 0011 §1: the cart's *current* public
// prices (via repriceCartLines, same as CartQuote), never the supplier/cost
// fields. `kind` is included for the frontend and for T4.10's future
// 'configuration' variant; only 'cart' exists today.
export const PublicShareDTOSchema = z.strictObject({
  kind: z.literal('cart'),
  lines: z.array(CartQuoteLineSchema),
  itemsTotalGel: z.number(),
  expiresAt: z.string(),
})
export type PublicShareDTO = z.infer<typeof PublicShareDTOSchema>
