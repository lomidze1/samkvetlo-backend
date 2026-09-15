import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { publicRead } from '../access/publicRead'
import { slugify } from '../lib/translit'

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
  ],
}
