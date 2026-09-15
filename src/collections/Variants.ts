import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { publicReadVariantOfPublishedProduct } from '../access/publicReadVariantOfPublishedProduct'
import {
  recomputeProductPricingAfterChange,
  recomputeProductPricingAfterDelete,
} from './hooks/variantPricing'
import { generateVariantSku } from './hooks/variantSku'
import { revalidateAfterChange, revalidateAfterDelete } from './hooks/revalidate'

// ADR 0002 §2 / _doc/design/pages.md §2 filter list — fixed in code on purpose
// (terminology stays stable; a new coating needs a deploy).
const COATING_OPTIONS = [
  { label: 'მოოქროვება', value: 'gilding' },
  { label: 'მოვერცხლვა', value: 'silvering' },
  { label: 'ოქროს ფურცელი', value: 'gold-leaf' },
  { label: 'მინანქარი', value: 'enamel' },
  { label: 'დაფარვის გარეშე', value: 'none' },
] as const

export const Variants: CollectionConfig = {
  slug: 'variants',
  labels: {
    singular: 'ვარიანტი',
    plural: 'ვარიანტები',
  },
  admin: {
    useAsTitle: 'title',
  },
  access: {
    // ADR 0005: a variant of a still-draft product must not leak through
    // an anonymous request either (issue found in code review of T1.1–T1.8).
    read: publicReadVariantOfPublishedProduct,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: {
    afterChange: [generateVariantSku, recomputeProductPricingAfterChange, revalidateAfterChange(['catalog'])],
    afterDelete: [recomputeProductPricingAfterDelete, revalidateAfterDelete(['catalog'])],
  },
  fields: [
    {
      name: 'product',
      type: 'relationship',
      relationTo: 'products',
      required: true,
      label: 'პროდუქტი',
    },
    {
      name: 'title',
      type: 'text',
      required: true,
      label: 'სახელი',
      admin: { description: 'მაგ. „მოოქროვილი · 50 კგ“' },
    },
    {
      name: 'coating',
      type: 'select',
      required: true,
      label: 'დაფარვა',
      options: [...COATING_OPTIONS],
      defaultValue: 'none',
    },
    {
      name: 'size',
      type: 'text',
      label: 'ზომა',
    },
    {
      name: 'weightKg',
      type: 'number',
      label: 'წონა (კგ)',
      min: 0,
    },
    {
      name: 'diameterMm',
      type: 'number',
      label: 'დიამეტრი (მმ)',
      min: 0,
    },
    {
      name: 'heightMm',
      type: 'number',
      label: 'სიმაღლე (მმ)',
      min: 0,
    },
    {
      name: 'sortOrder',
      type: 'number',
      label: 'რიგითობა',
      defaultValue: 0,
    },
    {
      name: 'sku',
      type: 'text',
      unique: true,
      label: 'SKU',
      admin: { readOnly: true, description: 'ავტომატურად ივსება (SMK-000123)' },
      access: { update: () => false },
    },
    {
      name: 'availability',
      type: 'select',
      required: true,
      label: 'ხელმისაწვდომობა',
      defaultValue: 'ready',
      options: [
        { label: 'მზა მარაგშია', value: 'ready' },
        { label: 'დამზადებაზე შეკვეთით', value: 'made-to-order' },
      ],
    },
    {
      name: 'leadTimeText',
      type: 'text',
      label: 'ვადა',
      admin: { description: 'მაგ. „7–14 დღე“' },
    },
    {
      name: 'price',
      type: 'number',
      label: 'ფასი (₾)',
      min: 0,
      admin: {
        readOnly: true,
        description: 'იცვლება მხოლოდ ფასის დადასტურებით (Costing → დადასტურება)',
      },
      // ADR 0006 §4: the site price only ever changes through the approve
      // endpoint (which writes via the Local API with overrideAccess).
      access: { update: () => false },
    },
    {
      name: 'priceStatus',
      type: 'select',
      label: 'ფასის სტატუსი',
      defaultValue: 'draft',
      options: [
        { label: 'გადასამუშავებელი', value: 'draft' },
        { label: 'დადასტურებული', value: 'approved' },
        { label: 'გადასინჯვა საჭიროა', value: 'needs-review' },
      ],
      admin: { readOnly: true },
      access: { update: () => false },
    },
  ],
}
