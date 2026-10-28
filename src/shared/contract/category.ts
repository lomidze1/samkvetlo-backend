// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012)
import { z } from 'zod'

export interface PublicCategory {
  slug: string
  name: string
  /** Short text under the category page's h1; absent when the admin left it empty. */
  intro?: string
  children: PublicCategory[]
}

// Recursive, so z.lazy is required (ADR 0012 §3: PublicCategory[] as a tree).
export const PublicCategorySchema: z.ZodType<PublicCategory> = z.lazy(() =>
  z.strictObject({
    slug: z.string(),
    name: z.string(),
    intro: z.string().optional(),
    children: z.array(PublicCategorySchema),
  }),
)

// The flat reference used inside product DTOs (no children — avoids an
// unbounded tree on every product card).
export const PublicCategoryRefSchema = z.strictObject({
  slug: z.string(),
  name: z.string(),
})
export type PublicCategoryRef = z.infer<typeof PublicCategoryRefSchema>
