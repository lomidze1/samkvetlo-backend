import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { publicRead } from '../access/publicRead'
import { renameUploadedFile } from './hooks/renameUpload'
import { assertAllowedFileType } from './hooks/validateFileType'

// ADR 0013 §6: product certificates/passports (PDF) and bell sound (MP3/M4A).
// audio/x-m4a: what file-type 22.1.0 actually detects for M4A (see
// validateFileType.ts) — audio/mp4 is kept too for any M4A variant that
// detects that way.
const PUBLIC_FILE_MIME_TYPES = ['application/pdf', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a'] as const

export const PublicFiles: CollectionConfig = {
  slug: 'public-files',
  labels: {
    singular: 'საჯარო ფაილი',
    plural: 'საჯარო ფაილები',
  },
  access: {
    read: publicRead,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  upload: {
    mimeTypes: [...PUBLIC_FILE_MIME_TYPES],
    disableLocalStorage: false,
  },
  hooks: {
    beforeOperation: [
      async ({ req, operation }) => {
        if (operation !== 'create' && operation !== 'update') return
        if (!req.file) return

        const extension = await assertAllowedFileType(req, PUBLIC_FILE_MIME_TYPES)
        renameUploadedFile(req, extension)
      },
    ],
  },
  fields: [],
}
