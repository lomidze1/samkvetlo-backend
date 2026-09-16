// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0011 §3, ADR 0012 §3, ADR 0014 §5)
import { z } from 'zod'

import { PhoneSchema } from './phone'

// ADR 0011 §3: the 5 categories the owner asked for, plus "other".
export const CUSTOM_REQUEST_CATEGORY_VALUES = [
  'iconostasis',
  'vestments',
  'vessels',
  'icon',
  'other',
] as const
export type CustomRequestCategory = (typeof CUSTOM_REQUEST_CATEGORY_VALUES)[number]

// Same sanitize/limits approach as order.ts (chief-architect, T3.2): every
// zod issue message is one of exactly 'required' | 'tooLong' | 'invalid', so
// publicEndpoint's `fields` map is enough for the frontend to pick a
// Georgian message from ka.ts.
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

// ADR 0011 §3 (+ ADR 0014 §5 limits). Attachments are not part of this
// schema — they arrive as multipart files (req.files.attachments), handled
// and validated separately (src/server/customRequests/attachments.ts) since
// zod validates only the `_payload` JSON fields of the multipart body.
export const CustomRequestInputSchema = z.strictObject({
  name: requiredText(60),
  surname: requiredText(60),
  phone: PhoneSchema,
  church: requiredText(120),
  city: optionalText(60),
  email: optionalEmail(),
  category: z.enum(CUSTOM_REQUEST_CATEGORY_VALUES, { error: 'required' }),
  // The public product DTO exposes only `slug` (ADR 0005 keeps internal ids
  // out of it), so this is the one way the frontend can identify a product.
  // submitCustomRequest resolves it to a row id; an unknown or unpublished
  // slug is a business decision made there, not a validation error here.
  product: optionalText(200),
  description: requiredText(2000),
  budgetText: optionalText(200),
  deadlineText: optionalText(200),
  submissionId: z.uuid('invalid'),
  turnstileToken: z.string({ error: 'required' }).min(1, 'required'),
})
export type CustomRequestInput = z.infer<typeof CustomRequestInputSchema>

export const CustomRequestResultSchema = z.strictObject({
  number: z.string(),
})
export type CustomRequestResult = z.infer<typeof CustomRequestResultSchema>
