import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { approvePriceEndpoint } from '../endpoints/approvePrice'
import { computeCostingFields } from './hooks/costingCalculation'
import { validateAutoPricing } from './hooks/validateAutoPricing'

// ADR 0005/0006: cost + markup calculation, one per variant. Admin-only —
// this is exactly the data our-goal §4 says must never reach the site.
export const Costings: CollectionConfig = {
  slug: 'costings',
  labels: {
    singular: 'კალკულაცია',
    plural: 'კალკულაციები',
  },
  admin: {
    useAsTitle: 'variant',
    // M8: the columns needed to see at a glance which variant awaits
    // confirmation (see `defaultSort` below) — before this, the list
    // showed only id/variant/updatedAt and the owner had to open each
    // record to check `approvedAt`.
    defaultColumns: ['variant', 'supplier', 'indicator', 'proposedPriceGel', 'suggestedPriceGel', 'approvedAt'],
  },
  // '-approvedAt' (not 'approvedAt'): Postgres's ASC default is NULLS
  // LAST, so ascending would bury the unapproved (null) rows at the
  // *bottom*. DESC defaults to NULLS FIRST, which is what we want here.
  defaultSort: '-approvedAt',
  access: {
    read: isAdmin,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  endpoints: [approvePriceEndpoint],
  hooks: {
    beforeValidate: [validateAutoPricing],
    beforeChange: [computeCostingFields],
  },
  fields: [
    { name: 'variant', type: 'relationship', relationTo: 'variants', required: true, unique: true, label: 'ვარიანტი' },
    { name: 'supplier', type: 'relationship', relationTo: 'suppliers', label: 'მომწოდებელი' },
    { name: 'supplierUrl', type: 'text', label: 'მომწოდებლის ბმული' },
    { name: 'supplierSku', type: 'text', label: 'მომწოდებლის არტიკული' },
    { name: 'costRub', type: 'number', required: true, label: 'ღირებულება (₽)', min: 0 },
    { name: 'logisticsGel', type: 'number', required: true, label: 'ლოგისტიკა თბილისამდე (₾)', min: 0 },
    { name: 'otherCostsGel', type: 'number', label: 'სხვა ხარჯი (₾)', defaultValue: 0, min: 0 },
    {
      name: 'bankFeePct',
      type: 'number',
      label: 'საბანკო საკომისიო (%)',
      min: 0,
      admin: { description: 'ცარიელია → pricing-settings-ის default' },
    },
    {
      name: 'bufferPct',
      type: 'number',
      label: 'ბუფერი (%)',
      min: 0,
      admin: { description: 'ცარიელია → pricing-settings-ის default' },
    },
    { name: 'georgianMarketPriceGel', type: 'number', label: 'ქართული ბაზრის ფასი (₾)', min: 0 },
    { name: 'notes', type: 'textarea', label: 'შენიშვნები' },

    // Computed by computeCostingFields (beforeChange) — read-only.
    { name: 'rateDate', type: 'date', label: 'კურსის თარიღი', admin: { readOnly: true } },
    { name: 'rubGel', type: 'number', label: 'RUB/GEL', admin: { readOnly: true } },
    { name: 'usdGel', type: 'number', label: 'USD/GEL', admin: { readOnly: true } },
    { name: 'pUsed', type: 'number', label: 'გამოყენებული P%', admin: { readOnly: true } },
    { name: 'costGel', type: 'number', label: 'C (₾)', admin: { readOnly: true } },
    { name: 'markupGel', type: 'number', label: 'ფასნამატი (₾)', admin: { readOnly: true } },
    { name: 'suggestedPriceGel', type: 'number', label: 'შემოთავაზებული ფასი (₾)', admin: { readOnly: true } },
    { name: 'markupSharePct', type: 'number', label: 'ფასნამატის წილი (%)', admin: { readOnly: true } },
    {
      name: 'indicator',
      type: 'select',
      label: 'ინდიკატორი',
      admin: { readOnly: true },
      options: [
        { label: '🟢', value: 'green' },
        { label: '🟡', value: 'yellow' },
        { label: '🔴', value: 'red' },
      ],
    },

    { name: 'proposedPriceGel', type: 'number', label: 'შესათანხმებელი ფასი (₾)', min: 0 },
    {
      name: 'autoPricing',
      type: 'checkbox',
      label: 'ავტომატური ფასი',
      defaultValue: false,
    },

    // Written only by the approve endpoint / rate-sync (T1.6) — never by hand.
    {
      name: 'priceHistory',
      type: 'array',
      label: 'ფასის ისტორია',
      admin: { readOnly: true },
      fields: [
        { name: 'from', type: 'number', label: 'ძველი ფასი' },
        { name: 'to', type: 'number', required: true, label: 'ახალი ფასი' },
        { name: 'by', type: 'relationship', relationTo: 'users', label: 'ვინ' },
        { name: 'at', type: 'date', required: true, label: 'როდის' },
        { name: 'reason', type: 'text', label: 'მიზეზი' },
        { name: 'rateDate', type: 'date', label: 'კურსის თარიღი' },
        { name: 'auto', type: 'checkbox', defaultValue: false, label: 'ავტომატური' },
      ],
    },
    { name: 'approvedBy', type: 'relationship', relationTo: 'users', label: 'დაადასტურა', admin: { readOnly: true } },
    { name: 'approvedAt', type: 'date', label: 'დადასტურების დრო', admin: { readOnly: true } },

    // T1.4: sidebar action calling the approve endpoint above.
    {
      name: 'approveAction',
      type: 'ui',
      label: 'დადასტურება',
      admin: {
        position: 'sidebar',
        components: {
          Field: '/components/admin/ApprovePriceButton#ApprovePriceButton',
        },
      },
    },
  ],
}
