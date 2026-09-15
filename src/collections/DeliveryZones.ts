import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { publicRead } from '../access/publicRead'
import { slugify } from '../lib/translit'
import { guardTbilisiDelete, guardTbilisiUpdate } from './hooks/deliveryZoneGuard'
import { revalidateAfterChange, revalidateAfterDelete } from './hooks/revalidate'

// ADR 0015 §1: no hidden field here (ADR 0005 layer 1) — the fee is meant
// to be public, it just isn't baked into the variant price (§5).
export const DeliveryZones: CollectionConfig = {
  slug: 'delivery-zones',
  labels: {
    singular: 'მიწოდების ზონა',
    plural: 'მიწოდების ზონები',
  },
  admin: {
    useAsTitle: 'name',
    defaultColumns: ['name', 'feeGel', 'sortOrder', 'active'],
  },
  access: {
    read: publicRead,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  hooks: {
    beforeValidate: [
      // Auto from `name` only while empty — unlike Categories/Products,
      // ADR 0015 explicitly allows the owner to hand-edit the slug
      // afterwards (it's used in the storefront's <select> value/URL, not
      // as a route param a redirect needs to track).
      ({ data }) => {
        if (data && !data.slug && typeof data.name === 'string' && data.name.length > 0) {
          return { ...data, slug: slugify(data.name) }
        }
        return data
      },
    ],
    beforeChange: [guardTbilisiUpdate],
    beforeDelete: [guardTbilisiDelete],
    afterChange: [revalidateAfterChange(['settings'])],
    afterDelete: [revalidateAfterDelete(['settings'])],
  },
  fields: [
    { name: 'name', type: 'text', required: true, label: 'სახელი', admin: { description: '„თბილისი“, „აჭარა“…' } },
    {
      name: 'slug',
      type: 'text',
      unique: true,
      label: 'Slug',
      admin: { description: 'ავტომატურად ივსება სახელიდან, შემდეგ ხელით შეცვლადია' },
    },
    {
      name: 'examples',
      type: 'text',
      label: 'მაგალითი ქალაქები',
      maxLength: 120,
      admin: { description: '„ბათუმი, ქობულეთი…“ — ჩანს select-ის ოფციაში' },
    },
    {
      name: 'feeGel',
      type: 'number',
      required: true,
      label: 'ტარიფი (₾)',
      min: 0,
      max: 10_000,
      admin: { description: 'მთელი ლარი. თბილისი = 0' },
      validate: (value: unknown) => {
        if (typeof value !== 'number' || !Number.isFinite(value)) return 'ტარიფი სავალდებულოა'
        if (!Number.isInteger(value)) return 'ტარიფი მთელი რიცხვი უნდა იყოს (₾)'
        if (value < 0 || value > 10_000) return 'ტარიფი 0–10 000 ₾ შორის უნდა იყოს'
        return true
      },
    },
    {
      name: 'sortOrder',
      type: 'number',
      label: 'რიგითობა',
      defaultValue: 100,
      admin: { description: 'თბილისი = 0' },
    },
    {
      name: 'active',
      type: 'checkbox',
      label: 'აქტიური',
      defaultValue: true,
      admin: { description: 'გამორთული ზონა საიტზე არ ჩანს და შეკვეთაში არ მიიღება' },
    },
  ],
}
