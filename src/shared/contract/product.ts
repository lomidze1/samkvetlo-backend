// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012)
import { z } from 'zod'

import { PublicCategoryRefSchema } from './category'
import { PublicImageSchema } from './image'
import { RichBlockSchema } from './richText'

export const COATING_VALUES = ['gilding', 'silvering', 'gold-leaf', 'enamel', 'none'] as const
export const AVAILABILITY_VALUES = ['ready', 'made-to-order'] as const
export const TIER_VALUES = ['flagship', 'standard'] as const

export const PublicVariantSchema = z.strictObject({
  id: z.number(),
  sku: z.string().nullable(),
  title: z.string(),
  coating: z.enum(COATING_VALUES),
  size: z.string().nullable(),
  weightKg: z.number().nullable(),
  diameterMm: z.number().nullable(),
  heightMm: z.number().nullable(),
  sortOrder: z.number(),
  availability: z.enum(AVAILABILITY_VALUES),
  leadTimeText: z.string().nullable(),
  price: z.number().nullable(),
  purchasable: z.boolean(),
})
export type PublicVariant = z.infer<typeof PublicVariantSchema>

// D19 (ADR 0005/0009): `issuer` is the one field where a supplier/manufacturer
// name is allowed. `title` only (no `kind`/review flag — not needed by the
// storefront and the review flag is an internal checklist item).
export const PublicDocumentSchema = z.strictObject({
  title: z.string(),
  kind: z.enum(['certificate', 'passport', 'other']),
  url: z.string(),
  issuer: z.string().nullable(),
})
export type PublicDocument = z.infer<typeof PublicDocumentSchema>

export const PublicVideoSchema = z.strictObject({
  youtubeId: z.string(),
  poster: PublicImageSchema.nullable(),
  title: z.string().nullable(),
})
export type PublicVideo = z.infer<typeof PublicVideoSchema>

export const PublicProductCardSchema = z.strictObject({
  slug: z.string(),
  title: z.string(),
  category: PublicCategoryRefSchema,
  tier: z.enum(TIER_VALUES),
  featured: z.boolean(),
  image: PublicImageSchema.nullable(),
  minPrice: z.number().nullable(),
  isPurchasable: z.boolean(),
})
export type PublicProductCard = z.infer<typeof PublicProductCardSchema>

export const PublicProductSchema = z.strictObject({
  slug: z.string(),
  title: z.string(),
  category: PublicCategoryRefSchema,
  tier: z.enum(TIER_VALUES),
  featured: z.boolean(),
  description: z.array(RichBlockSchema),
  features: z.array(z.strictObject({ label: z.string(), value: z.string() })),
  gallery: z.array(PublicImageSchema),
  whyQuality: z.array(RichBlockSchema).nullable(),
  documents: z.array(PublicDocumentSchema),
  videos: z.array(PublicVideoSchema),
  sound: z.string().nullable(),
  variants: z.array(PublicVariantSchema),
  minPrice: z.number().nullable(),
  isPurchasable: z.boolean(),
})
export type PublicProduct = z.infer<typeof PublicProductSchema>
