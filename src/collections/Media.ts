import sharp from 'sharp'
import { APIError, type CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { publicRead } from '../access/publicRead'
import { generateBlurDataURL } from './hooks/blurDataURL'
import { renameUploadedFile, stripImageMetadata } from './hooks/renameUpload'
import { revalidateAfterChange, revalidateAfterDelete } from './hooks/revalidate'
import { assertAllowedFileType } from './hooks/validateFileType'

// ADR 0013 §2: WebP sizes generated on upload; the loader (T2.9) resolves
// to whichever of these is >= the requested render width.
const IMAGE_WIDTHS = [320, 640, 960, 1280, 1920] as const
const MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

// ADR 0013 §7: smaller originals are rejected instead of being upscaled.
// 2026-10-16: lowered from 1280 to 640 — the supplier's icon photos are
// 680–860 px wide and the owner asked for real photos now; the card (≤ 300 px)
// and gallery (≤ 640 px) never upscale them, only the lightbox does. ⏳ owner
// review; see ADR 0013 update note.
const MIN_IMAGE_WIDTH = 640

export const Media: CollectionConfig = {
  slug: 'media',
  labels: {
    singular: 'ფოტო',
    plural: 'ფოტოები',
  },
  access: {
    read: publicRead,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  upload: {
    mimeTypes: [...MEDIA_MIME_TYPES],
    focalPoint: true,
    adminThumbnail: 'w320',
    imageSizes: [
      ...IMAGE_WIDTHS.map((width) => ({
        name: `w${width}`,
        width,
        withoutEnlargement: false,
        formatOptions: { format: 'webp' as const, options: { quality: 78 } },
        generateImageName: ({ originalName, sizeName }: { originalName: string; sizeName: string }) =>
          `${originalName}-${sizeName}.webp`,
      })),
      {
        name: 'og',
        width: 1200,
        height: 630,
        position: 'centre' as const,
        formatOptions: { format: 'jpeg' as const, options: { quality: 82, mozjpeg: true } },
        generateImageName: ({ originalName }: { originalName: string }) => `${originalName}-og.jpg`,
      },
    ],
  },
  hooks: {
    beforeOperation: [
      async ({ req, operation }) => {
        if (operation !== 'create' && operation !== 'update') return
        if (!req.file) return

        const extension = await assertAllowedFileType(req, MEDIA_MIME_TYPES)

        const metadata = await sharp(req.file.data).metadata()
        if (!metadata.width || metadata.width < MIN_IMAGE_WIDTH) {
          throw new APIError(
            `ფოტოს სიგანე უნდა იყოს მინიმუმ ${MIN_IMAGE_WIDTH}px (მიღებულია ${metadata.width ?? '?'}px)`,
            400,
          )
        }

        await stripImageMetadata(req, extension)
        renameUploadedFile(req, extension)
      },
    ],
    afterChange: [revalidateAfterChange(['catalog'])],
    afterDelete: [revalidateAfterDelete(['catalog'])],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      label: 'ტექსტი (alt)',
    },
    {
      name: 'blurDataURL',
      type: 'text',
      admin: { hidden: true },
      hooks: { beforeChange: [generateBlurDataURL] },
    },
  ],
}
