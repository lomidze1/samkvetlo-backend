// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012)
import { z } from 'zod'

/**
 * ADR 0012 §3 / ADR 0013 §3: a public image, mapped from a `media` document.
 * `key` is the renamed-on-upload filename (UUID + original extension, e.g.
 * `3f2c….jpg`) — not a URL. The frontend's custom `next/image` loader
 * builds `${NEXT_PUBLIC_MEDIA_URL}/${key}-w{width}.webp` from it (Payload's
 * own `imageSizes.generateImageName` produces exactly that filename).
 */
export const PublicImageSchema = z.strictObject({
  key: z.string(),
  alt: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  blurDataURL: z.string().nullable(),
})
export type PublicImage = z.infer<typeof PublicImageSchema>
