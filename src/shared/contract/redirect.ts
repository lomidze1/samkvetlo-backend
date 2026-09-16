// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012)
import { z } from 'zod'

export const REDIRECT_TYPE_VALUES = ['product', 'category'] as const

export const RedirectResultSchema = z.strictObject({
  to: z.string(),
})
export type RedirectResult = z.infer<typeof RedirectResultSchema>
