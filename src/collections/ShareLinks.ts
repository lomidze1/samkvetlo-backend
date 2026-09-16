import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { isAdminField } from '../access/isAdminField'

// ADR 0011 §1 / ADR 0014 §13: admin-only. `create` is closed even for
// admins — a share link is only ever written by createShareLink (T3.8) via
// the Local API with overrideAccess. No `versions`. Only `kind: 'cart'` is
// implemented yet — 'configuration' is T4.10 (Phase 4, needs the
// `configurations` collection); the select option is declared now so that
// column doesn't need a later migration to widen it.
export const ShareLinks: CollectionConfig = {
  slug: 'share-links',
  labels: {
    singular: 'გაზიარების ბმული',
    plural: 'გაზიარების ბმულები',
  },
  admin: {
    useAsTitle: 'tokenHash',
    defaultColumns: ['kind', 'viewCount', 'expiresAt', 'revokedAt', 'createdAt'],
  },
  access: {
    read: isAdmin,
    create: () => false,
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    {
      name: 'kind',
      type: 'select',
      required: true,
      label: 'ტიპი',
      options: [
        { label: 'კალათა', value: 'cart' },
        { label: 'კონფიგურაცია', value: 'configuration' },
      ],
    },
    {
      name: 'tokenHash',
      type: 'text',
      required: true,
      unique: true,
      label: 'Token hash',
      admin: { description: 'sha256(token) — token თავად DB-ში არ ინახება (ADR 0014 §13)' },
    },
    { name: 'ownerSecretHash', type: 'text', required: true, label: 'Owner secret hash' },
    {
      name: 'cartLines',
      type: 'array',
      label: 'კალათის ხაზები',
      admin: { description: 'ფასის გარეშე (ADR 0011 §1) — მიმდინარე ფასი DTO-ში ცოცხლად ითვლება' },
      fields: [
        { name: 'variantId', type: 'number', required: true, label: 'ვარიანტის ID' },
        { name: 'qty', type: 'number', required: true, min: 1, label: 'რაოდენობა' },
        { name: 'configurationId', type: 'text', label: 'Configuration ID' },
      ],
    },
    { name: 'expiresAt', type: 'date', required: true, label: 'ვადა', admin: { readOnly: true } },
    { name: 'revokedAt', type: 'date', label: 'გაუქმების დრო', admin: { readOnly: true } },
    {
      name: 'viewCount',
      type: 'number',
      defaultValue: 0,
      min: 0,
      label: 'ნახვები',
      admin: { readOnly: true },
    },
    { name: 'ipHash', type: 'text', label: 'IP hash (შემქმნელის)', access: { read: isAdminField } },
  ],
}
