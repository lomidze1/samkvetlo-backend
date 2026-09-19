import type { GlobalConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { isAdminField } from '../access/isAdminField'
import { publicRead } from '../access/publicRead'
import { revalidateGlobalAfterChange } from '../collections/hooks/revalidate'

// ADR 0007/0012 §3: public contact/social fields the storefront needs
// (read by everyone, incl. via /api/public/site-settings later, T1.9) next
// to admin-only notification settings (ADR 0005 layer 2: field-level access,
// since this is the one global that genuinely needs both).
export const SiteSettings: GlobalConfig = {
  slug: 'site-settings',
  label: 'საიტის პარამეტრები',
  access: {
    // Payload's own field-level access still hides ownerEmails/ownerPhones/
    // notifyCustomer/shareLinkTtlDays from an anonymous read below.
    read: publicRead,
    update: isAdmin,
  },
  hooks: {
    afterChange: [revalidateGlobalAfterChange(['settings'])],
  },
  fields: [
    { name: 'phone', type: 'text', label: 'ტელეფონი' },
    { name: 'email', type: 'text', label: 'ელფოსტა' },
    { name: 'address', type: 'text', label: 'მისამართი' },
    {
      name: 'social',
      type: 'array',
      label: 'სოციალური ქსელები',
      fields: [
        { name: 'label', type: 'text', required: true, label: 'სახელი' },
        { name: 'url', type: 'text', required: true, label: 'ბმული' },
      ],
    },
    {
      name: 'configuratorEnabled',
      type: 'checkbox',
      label: 'კონფიგურატორი ჩართულია',
      defaultValue: false,
      admin: { description: 'ADR 0010 — ჩაირთვება ქარხნის დადასტურების შემდეგ' },
    },

    // Admin-only (ADR 0005 layer 2): never reach an anonymous read of this
    // global, even though the global's own `read` access is public.
    {
      name: 'ownerEmails',
      type: 'array',
      label: 'მფლობელის ელფოსტები',
      access: { read: isAdminField },
      fields: [{ name: 'email', type: 'text', required: true, label: 'ელფოსტა' }],
    },
    {
      name: 'ownerPhones',
      type: 'array',
      label: 'მფლობელის ტელეფონები',
      access: { read: isAdminField },
      fields: [{ name: 'phone', type: 'text', required: true, label: 'ტელეფონი' }],
    },
    {
      name: 'notifyCustomer',
      type: 'checkbox',
      label: 'კლიენტს ეგზავნება შეტყობინება',
      defaultValue: false,
      access: { read: isAdminField },
    },
    {
      name: 'shareLinkTtlDays',
      type: 'number',
      label: 'გაზიარების ბმულის ვადა (დღე)',
      defaultValue: 90,
      min: 1,
      access: { read: isAdminField },
    },
    {
      // ADR 0014 §12 (D25), T5.12: the retention cron's anonymization clock,
      // kept here (not hardcoded) so a lawyer-driven change never needs a
      // code deploy.
      name: 'retentionYears',
      type: 'number',
      label: 'PII შენახვის ვადა (წელი)',
      defaultValue: 2,
      min: 1,
      access: { read: isAdminField },
    },
    // T5.x SEO contract: LocalBusiness JSON-LD needs a structured address,
    // separate from the free-text `address` above — kept off by default
    // (`publishAddress`) since the owner may not want the street address
    // public even once it's on file.
    {
      name: 'store',
      type: 'group',
      label: 'მაღაზიის მისამართი (LocalBusiness SEO)',
      fields: [
        { name: 'publishAddress', type: 'checkbox', label: 'საჯაროდ გამოქვეყნება', defaultValue: false },
        { name: 'streetAddress', type: 'text', label: 'ქუჩა და ნომერი' },
        { name: 'addressLocality', type: 'text', label: 'ქალაქი' },
        { name: 'postalCode', type: 'text', label: 'საფოსტო ინდექსი' },
      ],
    },
  ],
}
