import { fileTypeFromBuffer } from 'file-type'
import { APIError, type PayloadRequest } from 'payload'

/** Mime types we accept, mapped to the extension we rename the file to. */
const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  // file-type 22.1.0 detects an M4A's magic bytes as audio/x-m4a, not
  // audio/mp4 (code review finding on T1.1–T1.8) — both map to the same
  // extension.
  'audio/x-m4a': 'm4a',
}

/**
 * ADR 0005 layer 4 / ADR 0013 §7: trust only the file's magic bytes, never
 * the client-supplied MIME type or filename extension. Throws 415 on
 * mismatch. Returns the extension matching the *detected* type, so the
 * caller can rename the file consistently with its real content.
 */
export async function assertAllowedFileType(
  req: PayloadRequest,
  allowedMimeTypes: readonly string[],
): Promise<string> {
  const data = req.file?.data
  if (!data) {
    throw new APIError('ფაილი არ მოიძებნა', 400)
  }

  const detected = await fileTypeFromBuffer(data)
  const extension = detected ? EXTENSION_BY_MIME[detected.mime] : undefined

  if (!detected || !extension || !allowedMimeTypes.includes(detected.mime)) {
    throw new APIError(
      `ფაილის ტიპი მხარდაუჭერელია. დაშვებულია: ${allowedMimeTypes.join(', ')}`,
      415,
    )
  }

  return extension
}
