import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { publicRead } from '../access/publicRead'
import { slugify } from '../lib/translit'
import { revalidateAfterChange, revalidateAfterDelete } from './hooks/revalidate'
import { trackOldSlugs } from './hooks/trackOldSlugs'

// T1.2: routes that a category slug must never collide with.
export const PROTECTED_SLUGS = [
  'product',
  'cart',
  'checkout',
  'portfolio',
  'how-we-work',
  'about',
  'delivery',
  'contact',
  'account',
  'admin',
  'api',
  'search',
  's',
  'custom-request',
  'privacy',
  'go',
] as const

export const Categories: CollectionConfig = {
  slug: 'categories',
  labels: {
    singular: 'კატეგორია',
    plural: 'კატეგორიები',
  },
  admin: {
    useAsTitle: 'name',
  },
  access: {
    read: publicRead,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (data && typeof data.name === 'string' && data.name.length > 0) {
          return { ...data, slug: slugify(data.name) }
        }
        return data
      },
    ],
    beforeChange: [trackOldSlugs({ collection: 'categories' })],
    afterChange: [revalidateAfterChange(['catalog'])],
    afterDelete: [revalidateAfterDelete(['catalog'])],
  },
  fields: [
    {
      name: 'name',
      type: 'text',
      required: true,
      label: 'სახელი',
    },
    {
      name: 'slug',
      type: 'text',
      // Not `required`: always set by the beforeValidate hook above from
      // `name` (which is required), before field validation runs. Leaving
      // it optional here keeps the Local API's create() input type honest —
      // callers supply `name`, not `slug`.
      unique: true,
      label: 'Slug',
      admin: {
        readOnly: true,
        description: 'ავტომატურად ივსება სახელიდან',
      },
      validate: (value: unknown) => {
        if (typeof value === 'string' && (PROTECTED_SLUGS as readonly string[]).includes(value)) {
          return `„${value}“ დაცული გზაა და კატეგორიის slug-ად ვერ გამოიყენება`
        }
        return true
      },
    },
    {
      name: 'parent',
      type: 'relationship',
      relationTo: 'categories',
      label: 'მშობელი კატეგორია',
    },
    // design-plan-references.md 1.2 (after legacyicons.com): a short text
    // under the category page's h1; empty means the block isn't shown.
    {
      name: 'intro',
      type: 'textarea',
      label: 'შესავალი ტექსტი',
      admin: { description: '2–3 წინადადება კატეგორიის გვერდის სათაურის ქვეშ. ცარიელი = არ ჩანს.' },
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
