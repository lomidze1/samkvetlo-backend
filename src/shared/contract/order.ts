// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012 §3, ADR 0014 §5, ADR 0015)
import { z } from 'zod'

import { CART_MAX_LINES, CartLineInputSchema } from './cart'
import { PhoneSchema } from './phone'

// ADR 0014 §5: NFC + trim, control characters rejected. Every zod issue
// message below is one of exactly 'required' | 'tooLong' | 'invalid'
// (chief-architect, T3.2) — the field itself comes from the issue's path,
// so publicEndpoint's `fields` map (e.g. `{ church: 'tooLong' }`) is
// enough for the frontend to pick a Georgian message from ka.ts, with no
// per-field message string to maintain here.
// Tab/LF/CR (\x09,\x0A,\x0D) are allowed (a multi-line comment); every
// other C0 control character and DEL (\x7F) is rejected.
const CONTROL_CHARS_RE = new RegExp('[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F]')

function sanitize(value: string): string {
  return value.normalize('NFC').trim()
}

function requiredText(max: number) {
  return z
    .string({ error: 'required' })
    .transform(sanitize)
    .pipe(
      z
        .string()
        .min(1, 'required')
        .max(max, 'tooLong')
        .refine((value) => !CONTROL_CHARS_RE.test(value), 'invalid'),
    )
}

function optionalText(max: number) {
  return z
    .string()
    .transform(sanitize)
    .pipe(
      z
        .string()
        .max(max, 'tooLong')
        .refine((value) => !CONTROL_CHARS_RE.test(value), 'invalid'),
    )
    .optional()
}

function optionalEmail() {
  return z
    .string()
    .transform(sanitize)
    .pipe(
      z
        .string()
        .max(254, 'tooLong')
        .refine((value) => value.length === 0 || z.email().safeParse(value).success, 'invalid'),
    )
    .optional()
}

// ADR 0003 §3-4 / ADR 0015 §3: contact fields + required delivery zone
// (slug, resolved against the DB, never trusted for its fee) + the cart
// lines (repriced from the DB) + idempotency/anti-spam fields.
export const OrderInputSchema = z.strictObject({
  name: requiredText(60),
  surname: requiredText(60),
  phone: PhoneSchema,
  church: requiredText(120),
  // publicEndpoint mirrors this into a dedicated top-level code
  // (err.deliveryZone.required / err.deliveryZone.invalid) on top of
  // fields.deliveryZone (chief-architect, T3.2).
  deliveryZone: z.string({ error: 'required' }).min(1, 'required'),
  city: optionalText(60),
  email: optionalEmail(),
  comment: optionalText(1000),
  lines: z.array(CartLineInputSchema).min(1, 'required').max(CART_MAX_LINES, 'tooLong'),
  submissionId: z.uuid('invalid'),
  turnstileToken: z.string({ error: 'required' }).min(1, 'required'),
})
export type OrderInput = z.infer<typeof OrderInputSchema>

// ADR 0015 §4: `deliveryZone` (slug) lets the frontend build the
// thank-you redirect `?n=...&z=...` without re-reading the order (ADR
// 0003 §7 — no PII on that page).
export const OrderResultSchema = z.strictObject({
  number: z.string(),
  deliveryZone: z.string(),
})
export type OrderResult = z.infer<typeof OrderResultSchema>
