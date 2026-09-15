// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012)
import { z } from 'zod'

import { PublicImageSchema } from './image'

export const PublicPortfolioItemSchema = z.strictObject({
  slug: z.string(),
  church: z.string(),
  city: z.string().nullable(),
  photos: z.array(PublicImageSchema),
  products: z.array(z.strictObject({ slug: z.string(), title: z.string() })),
})
export type PublicPortfolioItem = z.infer<typeof PublicPortfolioItemSchema>
