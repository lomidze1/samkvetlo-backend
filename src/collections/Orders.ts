import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { isAdminField } from '../access/isAdminField'
import { createAnonymizeEndpoint } from '../endpoints/anonymize'
import { computeOrderTotals } from './hooks/orderTotals'
import { generateOrderNumber } from './hooks/orderNumber'
import { trackOrderStatusHistory } from './hooks/orderStatusHistory'

// ADR 0003/0005/0015, ADR 0014 §12: admin-only. `create` is closed even for
// admins — an Order is only ever written by the future submitOrder endpoint
// (T3.3) via the Local API with overrideAccess. No `versions` (D25: an old
// version would keep PII after anonymization).
const STATUS_OPTIONS = [
  { label: 'ახალი', value: 'new' },
  { label: 'დაკავშირებული', value: 'contacted' },
  { label: 'დადასტურებული', value: 'confirmed' },
  { label: 'გადახდილი', value: 'paid' },
  { label: 'შეკვეთილია მომწოდებელთან', value: 'ordered-from-supplier' },
  { label: 'გზაში', value: 'in-transit' },
  { label: 'მიწოდებული', value: 'delivered' },
  { label: 'გაუქმებული', value: 'cancelled' },
] as const

export const Orders: CollectionConfig = {
  slug: 'orders',
  labels: {
    singular: 'შეკვეთა',
    plural: 'შეკვეთები',
  },
  admin: {
    useAsTitle: 'number',
    defaultColumns: ['number', 'status', 'totalGel', 'createdAt'],
  },
  // M8: newest-first by default — without this, Payload sorts by createdAt
  // ascending (oldest orders first), which put every new order a full
  // page-scroll away from the top of the daily list.
  defaultSort: '-createdAt',
  access: {
    read: isAdmin,
    create: () => false,
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: {
    beforeChange: [computeOrderTotals, trackOrderStatusHistory],
    afterChange: [generateOrderNumber],
  },
  // T5.12 (ADR 0014 §12): manual "ანონიმიზაცია" — same anonymizeOrder the
  // retention cron uses.
  endpoints: [createAnonymizeEndpoint('orders')],
  fields: [
    {
      name: 'number',
      type: 'text',
      unique: true,
      label: 'ნომერი',
      admin: { readOnly: true, description: 'ავტომატურად: SMK-2026-000123' },
    },
    {
      name: 'submissionId',
      type: 'text',
      required: true,
      unique: true,
      label: 'submissionId',
      admin: { description: 'იდემპოტენტობა: კლიენტზე გენერირებული UUID (ADR 0003 §5)' },
    },

    // T3.5, ADR 0007 §6: ⚠ when any notifications[] entry failed. Virtual
    // field (no DB column) placed at the top so it's the first thing seen.
    {
      name: 'notificationsWarning',
      type: 'ui',
      label: 'შეტყობინებების გაფრთხილება',
      admin: {
        components: {
          Field: '/components/admin/FailedNotificationsWarning#FailedNotificationsWarning',
        },
      },
    },

    // Client (D25: anonymized 2 years after statusChangedAt).
    { name: 'name', type: 'text', required: true, label: 'სახელი' },
    { name: 'surname', type: 'text', required: true, label: 'გვარი' },
    { name: 'phone', type: 'text', required: true, label: 'ტელეფონი' },
    { name: 'church', type: 'text', required: true, label: 'ეკლესია / სამრევლო' },
    { name: 'city', type: 'text', label: 'ქალაქი / სოფელი' },
    { name: 'email', type: 'text', label: 'ელფოსტა' },
    { name: 'comment', type: 'textarea', label: 'კომენტარი' },
    {
      name: 'anonymizedAt',
      type: 'date',
      label: 'ანონიმიზაციის დრო',
      admin: { readOnly: true, description: 'ივსება ღამის cron-ით (D25) ან „ანონიმიზაცია“ ღილაკით — ველის რედაქტირება არ არის შესაძლებელი' },
    },
    // T5.12: sidebar action calling the endpoint above.
    {
      name: 'anonymizeAction',
      type: 'ui',
      label: 'ანონიმიზაცია',
      admin: {
        position: 'sidebar',
        components: {
          Field: '/components/admin/AnonymizeButton#AnonymizeButton',
        },
      },
    },

    // Line items (ADR 0003 §4.5) — every price field is a frozen snapshot.
    {
      name: 'items',
      type: 'array',
      required: true,
      minRows: 1,
      label: 'ნივთები',
      admin: {
        components: {
          RowLabel: '/components/admin/OrderItemRowLabel#OrderItemRowLabel',
        },
      },
      fields: [
        {
          name: 'variant',
          type: 'relationship',
          relationTo: 'variants',
          required: true,
          label: 'ვარიანტი',
          admin: { readOnly: true },
        },
        {
          name: 'productTitle',
          type: 'text',
          required: true,
          label: 'პროდუქტის სახელი',
          admin: { readOnly: true },
        },
        {
          name: 'variantTitle',
          type: 'text',
          required: true,
          label: 'ვარიანტის სახელი',
          admin: { readOnly: true },
        },
        { name: 'sku', type: 'text', required: true, label: 'SKU', admin: { readOnly: true } },
        {
          name: 'unitPrice',
          type: 'number',
          required: true,
          min: 0,
          label: 'ერთეულის ფასი (₾)',
          admin: { readOnly: true },
        },
        { name: 'qty', type: 'number', required: true, min: 1, label: 'რაოდენობა', admin: { readOnly: true } },
        {
          name: 'priceOnConfirmation',
          type: 'number',
          label: 'ფასი დადასტურებისას (₾)',
          admin: { readOnly: true },
        },
        {
          name: 'lineTotal',
          type: 'number',
          label: 'ხაზის ჯამი (₾)',
          admin: { readOnly: true },
        },
        {
          // D15: per-line patriarchate letter — secret today only because
          // the whole collection is admin-only; ADR 0005 §layer 2 names
          // this field specifically for when Phase 6 opens a customer view.
          name: 'patriarchateLetter',
          type: 'group',
          label: 'საპატრიარქოს წერილი',
          access: { read: isAdminField },
          fields: [
            { name: 'received', type: 'checkbox', label: 'მიღებულია', defaultValue: false },
            { name: 'file', type: 'upload', relationTo: 'private-files', label: 'ფაილი' },
          ],
        },
      ],
    },

    // Delivery snapshot (ADR 0015 §4) — frozen at order creation, never
    // recomputed by a hook, so a hard field-access lock is safe here.
    {
      name: 'deliveryZone',
      type: 'group',
      label: 'მიწოდების ზონა',
      admin: { description: 'ტექსტის snapshot — არა relationship (ADR 0015)' },
      fields: [
        { name: 'slug', type: 'text', label: 'Slug', access: { update: () => false } },
        { name: 'name', type: 'text', label: 'სახელი', access: { update: () => false } },
      ],
    },
    {
      name: 'deliveryFeeGel',
      type: 'number',
      label: 'მიწოდების საკომისიო (₾)',
      min: 0,
      admin: { readOnly: true },
      access: { update: () => false },
    },
    {
      name: 'itemsTotalGel',
      type: 'number',
      label: 'ნივთების ჯამი (₾)',
      admin: { readOnly: true, description: 'ავტომატურად ითვლება items[]-იდან' },
    },
    {
      name: 'totalGel',
      type: 'number',
      label: 'სრული ჯამი (₾)',
      admin: { readOnly: true, description: 'itemsTotalGel + deliveryFeeGel' },
    },

    // Status (ADR 0003 §8, D16: no "installed", "delivered" is final).
    {
      name: 'status',
      type: 'select',
      required: true,
      defaultValue: 'new',
      label: 'სტატუსი',
      options: [...STATUS_OPTIONS],
    },
    {
      name: 'statusHistory',
      type: 'array',
      label: 'სტატუსის ისტორია',
      admin: { readOnly: true },
      fields: [
        { name: 'from', type: 'select', options: [...STATUS_OPTIONS], label: 'იქიდან' },
        { name: 'to', type: 'select', required: true, options: [...STATUS_OPTIONS], label: 'მანამდე' },
        { name: 'by', type: 'relationship', relationTo: 'users', label: 'ვინ' },
        { name: 'at', type: 'date', required: true, label: 'როდის' },
      ],
    },
    {
      name: 'statusChangedAt',
      type: 'date',
      label: 'სტატუსის ცვლილების დრო',
      admin: { readOnly: true, description: 'D25: ანონიმიზაციის ათვლის წერტილი' },
    },

    // Internal-only (ADR 0005 §layer 2). Redundant with the collection-level
    // isAdmin read today; named explicitly for when Phase 6 opens a
    // customer-facing order view that must not see these.
    {
      name: 'payment',
      type: 'group',
      label: 'გადახდა',
      access: { read: isAdminField },
      fields: [
        { name: 'amountGel', type: 'number', min: 0, label: 'თანხა (₾)' },
        { name: 'paidAt', type: 'date', label: 'თარიღი' },
        { name: 'receivedBy', type: 'text', label: 'მიმღები (ი/მ)' },
      ],
    },
    { name: 'internalNotes', type: 'textarea', label: 'შიდა შენიშვნები', access: { read: isAdminField } },
    { name: 'supplierOrderNo', type: 'text', label: 'მომწოდებლის შეკვეთის №', access: { read: isAdminField } },
    { name: 'customsDeclaration', type: 'text', label: 'საბაჟო დეკლარაცია', access: { read: isAdminField } },
    {
      name: 'notifications',
      type: 'array',
      label: 'შეტყობინებები',
      access: { read: isAdminField },
      fields: [
        {
          name: 'channel',
          type: 'select',
          required: true,
          label: 'არხი',
          options: [
            { label: 'ელფოსტა', value: 'email' },
            { label: 'SMS', value: 'sms' },
          ],
        },
        {
          name: 'status',
          type: 'select',
          required: true,
          label: 'სტატუსი',
          options: [
            { label: 'გაგზავნილია', value: 'sent' },
            { label: 'ჩავარდა', value: 'failed' },
          ],
        },
        { name: 'error', type: 'text', label: 'შეცდომა' },
        { name: 'at', type: 'date', required: true, label: 'როდის' },
      ],
    },
    { name: 'ipHash', type: 'text', label: 'IP hash', access: { read: isAdminField } },
  ],
}
