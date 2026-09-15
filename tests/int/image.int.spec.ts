import { describe, expect, it } from 'vitest'

import { toPublicImage } from '@/server/public/image'
import type { Media } from '@/payload-types'

// T2.9 (frontend) needs `key` to match the on-disk filename Payload's own
// imageSizes.generateImageName produces for each size (extension stripped
// before the `-w{width}.webp` suffix — this bug shipped `key` with the
// extension still in the middle, so the frontend's custom loader 500'd).
describe('toPublicImage (ADR 0013 §3)', () => {
  const baseMedia = {
    id: 1,
    alt: 'ტესტი',
    updatedAt: '',
    createdAt: '',
    width: 2200,
    height: 2200,
    blurDataURL: null,
  } as unknown as Media

  it('strips the original extension so key matches the generated size filenames', () => {
    const result = toPublicImage({ ...baseMedia, filename: 'abc123.jpg' })
    expect(result?.key).toBe('abc123')
  })

  it('handles a filename without an extension', () => {
    const result = toPublicImage({ ...baseMedia, filename: 'abc123' })
    expect(result?.key).toBe('abc123')
  })

  it('returns null when filename/width/height is missing', () => {
    expect(toPublicImage({ ...baseMedia, filename: null })).toBeNull()
    expect(toPublicImage(null)).toBeNull()
    expect(toPublicImage(5)).toBeNull()
  })
})
