// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012)
import { z } from 'zod'

/** ADR 0012 §3 / ADR 0013: a public image, mapped from a `media` document. */
export const PublicImageSchema = z.strictObject({
  url: z.string(),
  alt: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blurDataURL: z.string().nullable(),
})
export type PublicImage = z.infer<typeof PublicImageSchema>
