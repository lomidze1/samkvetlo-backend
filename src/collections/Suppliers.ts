import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'

// ADR 0005: supplier data is secret — admin-only, and never referenced from
// a public collection (private -> public relationships only, never the
// reverse).
export const Suppliers: CollectionConfig = {
  slug: 'suppliers',
  labels: {
    singular: 'მომწოდებელი',
    plural: 'მომწოდებლები',
  },
  admin: {
    useAsTitle: 'name',
  },
  access: {
    read: isAdmin,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    { name: 'name', type: 'text', required: true, label: 'სახელი' },
    { name: 'website', type: 'text', label: 'საიტი' },
    { name: 'contact', type: 'text', label: 'კონტაქტი' },
    {
      name: 'photosAllowed',
      type: 'checkbox',
      label: 'ფოტოების გამოყენება დაშვებულია',
      defaultValue: false,
    },
    { name: 'photosCondition', type: 'text', label: 'პირობა' },
  ],
}
