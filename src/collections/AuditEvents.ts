import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'

// ADR 0016 (T5.14): a record of every admin login that used the
// break-glass exception (non-Georgia country header). Written only by
// Users.hooks.afterLogin (overrideAccess) — never by a request, admin UI
// button, or migration — so `create`/`update`/`delete` are all blocked
// here. Never stores the IP (only Vercel's Activity Log + proxy.ts's
// console.warn do, and only transiently).
export const AuditEvents: CollectionConfig = {
  slug: 'audit-events',
  labels: {
    singular: 'აუდიტის ჩანაწერი',
    plural: 'აუდიტის ჩანაწერები',
  },
  admin: {
    useAsTitle: 'type',
    defaultColumns: ['type', 'user', 'country', 'at'],
  },
  access: {
    read: isAdmin,
    create: () => false,
    update: () => false,
    delete: () => false,
  },
  fields: [
    { name: 'type', type: 'text', required: true, label: 'ტიპი', admin: { readOnly: true } },
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      label: 'მომხმარებელი',
      admin: { readOnly: true },
    },
    { name: 'country', type: 'text', label: 'ქვეყანა', admin: { readOnly: true } },
    { name: 'at', type: 'date', required: true, label: 'დრო', admin: { readOnly: true } },
  ],
}
