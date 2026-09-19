import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { isAdminField } from '../access/isAdminField'
import { createAnonymizeEndpoint } from '../endpoints/anonymize'
import { CUSTOM_REQUEST_CATEGORY_VALUES } from '../shared/contract/customRequest'
import { ka } from '../i18n/ka'
import { generateCustomRequestNumber } from './hooks/customRequestNumber'
import { trackCustomRequestStatusHistory } from './hooks/customRequestStatusHistory'

// ADR 0011 §3: admin-only, same shape as Orders (ADR 0003/0005). `create`
// is closed even for admins — a request is only ever written by
// submitCustomRequest (T3.7) via the Local API with overrideAccess. No
// `versions` (D25: an old version would keep PII after anonymization).
const CATEGORY_LABELS = ka.server.customRequestCategoryLabels

const STATUS_OPTIONS = [
  { label: 'ახალი', value: 'new' },
  { label: 'დაკავშირებული', value: 'contacted' },
  { label: 'შეფასებული', value: 'quoted' },
  { label: 'მოგებული', value: 'won' },
  { label: 'წაგებული', value: 'lost' },
] as const

export const CustomRequests: CollectionConfig = {
  slug: 'custom-requests',
  labels: {
    singular: 'ინდ. შეკვეთის მოთხოვნა',
    plural: 'ინდ. შეკვეთის მოთხოვნები',
  },
  admin: {
    useAsTitle: 'number',
    defaultColumns: ['number', 'category', 'status', 'name', 'surname', 'createdAt'],
  },
  // M8: newest-first by default, same reasoning as Orders.ts.
  defaultSort: '-createdAt',
  access: {
    read: isAdmin,
    create: () => false,
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: {
    beforeChange: [trackCustomRequestStatusHistory],
    afterChange: [generateCustomRequestNumber],
  },
  // T5.12 (ADR 0014 §12): manual "ანონიმიზაცია" — same
  // anonymizeCustomRequest the retention cron uses.
  endpoints: [createAnonymizeEndpoint('custom-requests')],
  fields: [
    {
      name: 'number',
      type: 'text',
      unique: true,
      label: 'ნომერი',
      admin: { readOnly: true, description: 'ავტომატურად: REQ-2026-000123' },
    },
    {
      name: 'submissionId',
      type: 'text',
      required: true,
      unique: true,
      label: 'submissionId',
      admin: { description: 'იდემპოტენტობა: კლიენტზე გენერირებული UUID (ADR 0003 §5 pipeline)' },
    },

    // Client (D25: anonymized 2 years after statusChangedAt, per T5.12).
    { name: 'name', type: 'text', required: true, label: 'სახელი' },
    { name: 'surname', type: 'text', required: true, label: 'გვარი' },
    { name: 'phone', type: 'text', required: true, label: 'ტელეფონი' },
    { name: 'church', type: 'text', required: true, label: 'ეკლესია / სამრევლო' },
    { name: 'city', type: 'text', label: 'ქალაქი / სოფელი' },
    { name: 'email', type: 'text', label: 'ელფოსტა' },
    {
      name: 'category',
      type: 'select',
      required: true,
      label: 'კატეგორია',
      options: CUSTOM_REQUEST_CATEGORY_VALUES.map((value) => ({ label: CATEGORY_LABELS[value], value })),
    },
    { name: 'product', type: 'relationship', relationTo: 'products', label: 'პროდუქტი' },
    { name: 'description', type: 'textarea', required: true, label: 'აღწერა' },
    {
      name: 'attachments',
      type: 'relationship',
      relationTo: 'private-files',
      hasMany: true,
      label: 'დანართები',
      admin: { description: 'მაქს. 5 ფაილი, ჯამში ≤ 4 MB (JPG/PNG/PDF)' },
    },
    { name: 'budgetText', type: 'text', label: 'ბიუჯეტი' },
    { name: 'deadlineText', type: 'text', label: 'ვადა' },
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

    // Internal-only (ADR 0011 §3).
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
    { name: 'internalNotes', type: 'textarea', label: 'შიდა შენიშვნები', access: { read: isAdminField } },
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
