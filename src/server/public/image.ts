import type { Media } from '../../payload-types'
import type { PublicImage } from '../../shared/contract/image'

/**
 * ADR 0005 layer 3: hand-written, explicit key-by-key mapping — never
 * `...doc` spread — so a field added to `media` later can't leak into the
 * public DTO without a matching change here.
 */
export function toPublicImage(media: Media | number | null | undefined): PublicImage | null {
  if (!media || typeof media === 'number') return null
  if (!media.url || !media.width || !media.height) return null

  return {
    url: media.url,
    alt: media.alt,
    width: media.width,
    height: media.height,
    blurDataURL: media.blurDataURL ?? null,
  }
}
