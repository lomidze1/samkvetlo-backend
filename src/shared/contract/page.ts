// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012)
import { z } from 'zod'

import { RichBlockSchema } from './richText'

export const PAGE_SLUGS = ['how-we-work', 'about', 'delivery', 'contact', 'privacy'] as const

export const PublicPageSchema = z.strictObject({
  slug: z.enum(PAGE_SLUGS),
  title: z.string(),
  content: z.array(RichBlockSchema),
})
export type PublicPage = z.infer<typeof PublicPageSchema>
