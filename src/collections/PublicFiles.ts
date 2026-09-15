import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { publicRead } from '../access/publicRead'
import { renameUploadedFile } from './hooks/renameUpload'
import { assertAllowedFileType } from './hooks/validateFileType'

// ADR 0013 §6: product certificates/passports (PDF) and bell sound (MP3/M4A).
const PUBLIC_FILE_MIME_TYPES = ['application/pdf', 'audio/mpeg', 'audio/mp4'] as const

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
