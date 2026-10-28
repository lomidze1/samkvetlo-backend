import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { publicReadPublished } from '../access/publicReadPublished'
import { slugify } from '../lib/translit'
import { createDefaultVariant } from './hooks/defaultVariant'
import { validateProductPublish } from './hooks/productPublishValidation'
import { revalidateAfterChange, revalidateAfterDelete } from './hooks/revalidate'
import { trackOldSlugs, type OldSlugTrackable } from './hooks/trackOldSlugs'
import { recomputeProductPricingBeforeChange } from './hooks/variantPricing'

// T5.4 (301 redirects): an unpublished product's slug was never public, so
// changing it shouldn't create a redirect.
function wasPublished(originalDoc: OldSlugTrackable & { _status?: string | null }): boolean {
  return originalDoc._status === 'published'
}

export const Products: CollectionConfig = {
  slug: 'products',
  labels: {
    singular: 'პროდუქტი',
    plural: 'პროდუქტები',
  },
  admin: {
    useAsTitle: 'title',
    defaultColumns: ['title', 'source', 'category', 'tier', '_status'],
  },
  access: {
    // ADR 0005: an anonymous ?draft=true request must never see a draft
    // (issue found in code review of T1.1–T1.8).
    read: publicReadPublished,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  versions: {
    drafts: true,
  },
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (data && typeof data.title === 'string' && data.title.length > 0) {
          return { ...data, slug: slugify(data.title) }
        }
        return data
      },
      validateProductPublish,
    ],
    beforeChange: [
      recomputeProductPricingBeforeChange,
      trackOldSlugs({ collection: 'products', shouldTrackRetiredSlug: wasPublished }),
    ],
    // ADR 0012 §5: catalog tag — the storefront's product list/detail pages.
    afterChange: [createDefaultVariant, revalidateAfterChange(['catalog'])],
    afterDelete: [revalidateAfterDelete(['catalog'])],
  },
  fields: [
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'სახელი',
    },
    {
      name: 'slug',
      type: 'text',
      // See Categories.ts: hook-derived from `title`, so not `required` —
      // that keeps the Local API's create() input type honest.
      unique: true,
      label: 'Slug',
      admin: {
        readOnly: true,
        description: 'ავტომატურად ივსება სახელიდან',
      },
    },
    {
      name: 'category',
      type: 'relationship',
      relationTo: 'categories',
      required: true,
      label: 'კატეგორია',
    },
    {
      name: 'tier',
      type: 'select',
      required: true,
      label: 'დონე',
      defaultValue: 'standard',
      options: [
        { label: 'Flagship ⭐', value: 'flagship' },
        { label: 'სტანდარტული', value: 'standard' },
      ],
    },
    {
      name: 'featured',
      type: 'checkbox',
      label: 'გამოკვეთილი',
      defaultValue: false,
    },
    {
      name: 'description',
      type: 'richText',
      required: true,
      label: 'აღწერა',
    },
    {
      name: 'features',
      type: 'array',
      label: 'მახასიათებლები',
      fields: [
        { name: 'label', type: 'text', required: true, label: 'სახელი' },
        { name: 'value', type: 'text', required: true, label: 'მნიშვნელობა' },
      ],
    },
    {
      name: 'gallery',
      type: 'upload',
      relationTo: 'media',
      hasMany: true,
      label: 'გალერეა',
      admin: { components: { Cell: '/components/admin/GalleryCell#GalleryCell' } },
    },
    {
      name: 'whyQuality',
      type: 'richText',
      label: '„რატომ ეს ხარისხი“',
    },
    {
      name: 'documents',
      type: 'array',
      label: 'დოკუმენტები / სერტიფიკატები',
      fields: [
        { name: 'title', type: 'text', required: true, label: 'სათაური' },
        {
          name: 'kind',
          type: 'select',
          required: true,
          label: 'ტიპი',
          options: [
            { label: 'სერტიფიკატი', value: 'certificate' },
            { label: 'პასპორტი', value: 'passport' },
            { label: 'სხვა', value: 'other' },
          ],
        },
        { name: 'file', type: 'upload', relationTo: 'public-files', required: true, label: 'ფაილი' },
        // D19 (ADR 0005/0009): free text, never a relationship to suppliers.
        { name: 'issuer', type: 'text', label: 'გამცემი / მწარმოებელი' },
        {
          name: 'reviewedNoSecretInfo',
          type: 'checkbox',
          label:
            'შევამოწმე: დოკუმენტზე არ ჩანს ფასი, მომწოდებლის ბმული/URL, ლოგისტიკა, შიდა არტიკული',
          defaultValue: false,
        },
      ],
    },
    {
      name: 'videos',
      type: 'array',
      label: 'ვიდეო',
      fields: [
        { name: 'youtubeId', type: 'text', required: true, label: 'YouTube ID' },
        { name: 'poster', type: 'upload', relationTo: 'media', required: true, label: 'პრევიუ ფოტო' },
        { name: 'title', type: 'text', label: 'სათაური' },
      ],
    },
    {
      name: 'sound',
      type: 'upload',
      relationTo: 'public-files',
      label: 'ზარის ხმა',
    },
    {
      name: 'variants',
      type: 'join',
      collection: 'variants',
      on: 'product',
      label: 'ვარიანტები',
    },
    {
      name: 'minPrice',
      type: 'number',
      label: 'მინ. ფასი (₾)',
      admin: { readOnly: true, description: 'ავტომატურად ითვლება ვარიანტებიდან' },
    },
    {
      name: 'isPurchasable',
      type: 'checkbox',
      label: 'იყიდება',
      defaultValue: false,
      admin: { readOnly: true, description: 'ავტომატურად ითვლება ვარიანტებიდან' },
    },

    // ADR 0006 §"− ფასი ორ ეკრანზეა" mitigation, T1.4: link to each
    // variant's costing (suggested ↔ current price + 🟢🟡🔴).
    {
      name: 'costingLinks',
      type: 'ui',
      label: 'ფასის კალკულაცია',
      admin: {
        position: 'sidebar',
        components: {
          Field: '/components/admin/ProductCostingLinks#ProductCostingLinks',
        },
      },
    },
    // List column only: link to the supplier's product page (admin-only).
    {
      name: 'source',
      type: 'ui',
      label: 'წყარო',
      admin: {
        components: {
          Field: false,
          Cell: '/components/admin/SourceLinks#ProductSourceCell',
        },
      },
    },
    // T5.4 (301 redirects): filled by trackOldSlugs, never by hand.
    {
      name: 'oldSlugs',
      type: 'array',
      label: 'ძველი Slug-ები',
      admin: { readOnly: true, description: 'ივსება ავტომატურად slug-ის შეცვლისას' },
      fields: [{ name: 'slug', type: 'text', required: true, index: true, label: 'Slug' }],
    },
  ],
}
