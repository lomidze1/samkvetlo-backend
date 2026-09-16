import { fileTypeFromBuffer } from 'file-type'

import { PublicHttpError } from '../../endpoints/public/publicEndpoint'

// ADR 0011 §3 default (owner-adjustable): max 5 files, <= 4 MB combined.
export const MAX_ATTACHMENTS = 5
export const MAX_ATTACHMENTS_TOTAL_BYTES = 4_000_000

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
}

export interface UploadedAttachment {
  data: Buffer
  name: string
}

/** UploadedAttachment + its detected (never client-supplied) MIME type. */
export interface ValidatedAttachment extends UploadedAttachment {
  mimeType: string
}

/**
 * ADR 0005 layer 4 / ADR 0014 §6: trusts only magic bytes, never the
 * client-supplied MIME type or filename extension. Checked before any
 * private-files document is created, so a rejected request never leaves a
 * partial attachments[] behind. Returns each file's detected MIME type so
 * the caller can pass it to `payload.create` — private-files' own upload
 * field would otherwise validate the (unset/placeholder) mimetype we'd
 * have to invent, and reject it before its own beforeOperation hook (which
 * only renames the file) ever runs.
 */
export async function validateAttachments(files: UploadedAttachment[]): Promise<ValidatedAttachment[]> {
  if (files.length > MAX_ATTACHMENTS) {
    throw new PublicHttpError(400, 'err.attachments.tooMany')
  }

  const totalBytes = files.reduce((sum, file) => sum + file.data.length, 0)
  if (totalBytes > MAX_ATTACHMENTS_TOTAL_BYTES) {
    throw new PublicHttpError(413, 'err.attachments.tooLarge')
  }

  const validated: ValidatedAttachment[] = []
  for (const file of files) {
    const detected = await fileTypeFromBuffer(file.data)
    if (!detected || !EXTENSION_BY_MIME[detected.mime]) {
      throw new PublicHttpError(415, 'err.attachments.invalidType')
    }
    validated.push({ ...file, mimeType: detected.mime })
  }
  return validated
}
