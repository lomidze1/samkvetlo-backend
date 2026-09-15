import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { publicReadPublished } from '../access/publicReadPublished'
import { slugify } from '../lib/translit'
import { validatePortfolioPublish } from './hooks/portfolioPublishValidation'
import { revalidateAfterChange, revalidateAfterDelete } from './hooks/revalidate'

// Architecture §3: our own completed work (church, city, photos, products
// used, consent). Public — no supplier/pricing data ever belongs here.
export const Portfolio: CollectionConfig = {
  slug: 'portfolio',
  labels: {
    singular: 'ნამუშევარი',
    plural: 'ნამუშევრები',
  },
  admin: {
    useAsTitle: 'church',
  },
  access: {
    // ADR 0005: an anonymous ?draft=true request must never see a draft.
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
      // T1.9: GET /api/public/portfolio/:slug (ADR 0012 §3) needs a stable
      // identifier — same auto-slug-from-title trick as Categories/Products.
      ({ data }) => {
        if (data && typeof data.church === 'string' && data.church.length > 0) {
          return { ...data, slug: slugify(data.church) }
        }
        return data
      },
      validatePortfolioPublish,
    ],
    afterChange: [revalidateAfterChange(['portfolio'])],
    afterDelete: [revalidateAfterDelete(['portfolio'])],
  },
  fields: [
    { name: 'church', type: 'text', required: true, label: 'ეკლესია' },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      label: 'Slug',
      admin: {
        readOnly: true,
        description: 'ავტომატურად ივსება ეკლესიის სახელიდან',
      },
    },
    { name: 'city', type: 'text', label: 'ქალაქი' },
    { name: 'photos', type: 'upload', relationTo: 'media', hasMany: true, required: true, label: 'ფოტოები' },
    { name: 'products', type: 'relationship', relationTo: 'products', hasMany: true, label: 'პროდუქტები' },
    {
      name: 'consent',
      type: 'checkbox',
      label: 'თანხმობა ✔ (ეკლესია/დამკვეთი დაეთანხმა ფოტოს გამოქვეყნებას)',
      defaultValue: false,
    },
  ],
}
