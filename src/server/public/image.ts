import type { Media } from '../../payload-types'
import type { PublicImage } from '../../shared/contract/image'

/**
 * ADR 0005 layer 3: hand-written, explicit key-by-key mapping — never
 * `...doc` spread — so a field added to `media` later can't leak into the
 * public DTO without a matching change here.
 */
export function toPublicImage(media: Media | number | null | undefined): PublicImage | null {
  if (!media || typeof media === 'number') return null
  if (!media.filename || !media.width || !media.height) return null

  return {
    // Media.imageSizes' generateImageName strips the original extension
    // before appending `-w{width}.webp` (e.g. `<uuid>-w1280.webp`, not
    // `<uuid>.jpg-w1280.webp`) — `key` must match that on-disk convention.
    key: media.filename.replace(/\.[^./]+$/, ''),
    alt: media.alt,
    width: media.width,
    height: media.height,
    blurDataURL: media.blurDataURL ?? null,
  }
}
