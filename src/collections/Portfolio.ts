import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { publicRead } from '../access/publicRead'
import { validatePortfolioPublish } from './hooks/portfolioPublishValidation'

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
    read: publicRead,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  versions: {
    drafts: true,
  },
  hooks: {
    beforeValidate: [validatePortfolioPublish],
  },
  fields: [
    { name: 'church', type: 'text', required: true, label: 'ეკლესია' },
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
