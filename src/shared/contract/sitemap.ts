// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012)
import { z } from 'zod'

export const SitemapProductSchema = z.strictObject({
  slug: z.string(),
  updatedAt: z.string(),
  imageKey: z.string().nullable(),
})
export type SitemapProduct = z.infer<typeof SitemapProductSchema>

// `path` is the full nested category path the frontend routes on (e.g.
// `/zarebi/saeklesio-zarebi`), not just the category's own slug.
export const SitemapCategorySchema = z.strictObject({
  path: z.string(),
  updatedAt: z.string(),
})
export type SitemapCategory = z.infer<typeof SitemapCategorySchema>

export const SitemapPageSchema = z.strictObject({
  slug: z.string(),
  updatedAt: z.string(),
})
export type SitemapPage = z.infer<typeof SitemapPageSchema>

export const SitemapPortfolioItemSchema = z.strictObject({
  slug: z.string(),
  updatedAt: z.string(),
})
export type SitemapPortfolioItem = z.infer<typeof SitemapPortfolioItemSchema>

export const PublicSitemapSchema = z.strictObject({
  products: z.array(SitemapProductSchema),
  categories: z.array(SitemapCategorySchema),
  pages: z.array(SitemapPageSchema),
  portfolio: z.array(SitemapPortfolioItemSchema),
})
export type PublicSitemap = z.infer<typeof PublicSitemapSchema>
