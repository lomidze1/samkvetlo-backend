import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import type { PayloadRequest } from 'payload'

const IMAGE_EXTENSIONS = new Set(['jpg', 'png', 'webp'])

/**
 * ADR 0005 layer 4: the original filename never reaches storage or the DB —
 * it may leak a supplier name (e.g. "sofrino_kadilo_740.jpg").
 */
export function renameUploadedFile(req: PayloadRequest, extension: string): void {
  if (!req.file) return
  req.file.name = `${randomUUID()}.${extension}`
}

/**
 * ADR 0005 layer 4 / ADR 0013 §2: Payload stores the uploaded original
 * as-is, so it (and any EXIF/GPS data in it) would otherwise reach disk
 * untouched. Re-encoding through sharp without `.withMetadata()` strips all
 * metadata from the original, same as the generated image sizes.
 */
export async function stripImageMetadata(req: PayloadRequest, extension: string): Promise<void> {
  if (!req.file || !IMAGE_EXTENSIONS.has(extension)) return

  const format = extension === 'jpg' ? 'jpeg' : extension === 'png' ? 'png' : 'webp'
  // .rotate() with no args reads the EXIF Orientation tag and bakes it into
  // the pixel data (swapping width/height for a 90°/270° rotation) before
  // toFormat() strips all metadata below — without it, a portrait phone
  // photo stored with Orientation=6 comes out sideways once the tag that
  // told viewers to rotate it is gone (code review finding on T1.1–T1.8).
  const reencoded = await sharp(req.file.data).rotate().toFormat(format).toBuffer()

  req.file.data = reencoded
  req.file.size = reencoded.length
}
