import sharp from 'sharp'
import type { FieldHook } from 'payload'

const BLUR_WIDTH = 16
const BLUR_QUALITY = 40

/**
 * ADR 0013 §2: a tiny (16px, ≤ 1 KB) base64 WebP placeholder, computed once
 * on upload from the original buffer. Field is hidden + read-only in the
 * admin UI. On an update with no new file, the previous value is kept.
 */
export const generateBlurDataURL: FieldHook = async ({ req, value }) => {
  const data = req.file?.data
  if (!data) return value

  const buffer = await sharp(data).resize(BLUR_WIDTH).webp({ quality: BLUR_QUALITY }).toBuffer()
  return `data:image/webp;base64,${buffer.toString('base64')}`
}
