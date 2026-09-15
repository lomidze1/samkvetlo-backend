import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { renameUploadedFile } from './hooks/renameUpload'
import { assertAllowedFileType } from './hooks/validateFileType'

// ADR 0005 / 0013 §1: patriarchate letters, configurator sketches, proofs —
// never public, never on the CDN. Served only by the backend, access-checked.
const PRIVATE_FILE_MIME_TYPES = ['image/jpeg', 'image/png', 'application/pdf'] as const

export const PrivateFiles: CollectionConfig = {
  slug: 'private-files',
  labels: {
    singular: 'შიდა ფაილი',
    plural: 'შიდა ფაილები',
  },
  access: {
    read: isAdmin,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  upload: {
    mimeTypes: [...PRIVATE_FILE_MIME_TYPES],
    disableLocalStorage: false,
  },
  hooks: {
    beforeOperation: [
      async ({ req, operation }) => {
        if (operation !== 'create' && operation !== 'update') return
        if (!req.file) return

        const extension = await assertAllowedFileType(req, PRIVATE_FILE_MIME_TYPES)
        renameUploadedFile(req, extension)
      },
    ],
  },
  fields: [],
}
