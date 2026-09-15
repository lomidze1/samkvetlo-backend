import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'

// ADR 0006: NBG rates, one row per day. Admin-only (never referenced by a
// public collection).
export const ExchangeRates: CollectionConfig = {
  slug: 'exchange-rates',
  labels: {
    singular: 'გაცვლითი კურსი',
    plural: 'გაცვლითი კურსები',
  },
  admin: {
    useAsTitle: 'date',
    defaultColumns: ['date', 'rubGel', 'usdGel'],
  },
  access: {
    read: isAdmin,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    { name: 'date', type: 'date', required: true, unique: true, label: 'თარიღი' },
    { name: 'rubGel', type: 'number', required: true, label: 'RUB/GEL', min: 0 },
    { name: 'usdGel', type: 'number', required: true, label: 'USD/GEL', min: 0 },
    { name: 'source', type: 'text', label: 'წყარო' },
    { name: 'fetchedAt', type: 'date', label: 'მოთხოვნის დრო' },
  ],
}
