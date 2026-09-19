import type { Access, CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { isAdminField } from '../access/isAdminField'
import { SHORT_LINK_SLUG_RE, SITE_HOSTS, parseShortLinkTarget } from '../shared/contract/shortLink'
import { revalidateAfterChange, revalidateAfterDelete } from './hooks/revalidate'

// ADR 0017 §1: an anonymous reader only ever sees active links — a
// disabled one falls back to `/` at redirect time (§3), so there's nothing
// useful for the storefront's own /api/public/short-links list to show for
// it, and the admin-only `note` field (below) is the one reason this
// collection isn't simply publicRead.
const publicReadActive: Access = ({ req }) => {
  if (req.user) return true
  return { active: { equals: true } }
}

const UTM_RE = /^[a-z0-9_-]{1,40}$/

// ADR 0017 §1: samkvetlo.ge/www.samkvetlo.ge absolute URLs are rewritten to
// a path here so a value copied from the browser's address bar just works.
function rewriteOwnDomainToPath(target: string): string {
  try {
    const url = new URL(target)
    if ((SITE_HOSTS as readonly string[]).includes(url.hostname)) {
      return `${url.pathname}${url.search}${url.hash}`
    }
  } catch {
    // Not a valid absolute URL — leave it as-is, validation below rejects it.
  }
  return target
}

export const ShortLinks: CollectionConfig = {
  slug: 'short-links',
  labels: {
    singular: 'მოკლე ბმული',
    plural: 'მოკლე ბმულები',
  },
  admin: {
    useAsTitle: 'slug',
    defaultColumns: ['slug', 'target', 'active', 'updatedAt'],
  },
  access: {
    read: publicReadActive,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  versions: false,
  hooks: {
    beforeValidate: [
      ({ data }) => {
        if (!data) return data
        const next = { ...data }
        if (typeof next.slug === 'string') {
          next.slug = next.slug.trim().toLowerCase()
        }
        if (typeof next.target === 'string') {
          next.target = rewriteOwnDomainToPath(next.target.trim())
        }
        return next
      },
    ],
    afterChange: [revalidateAfterChange(['links'])],
    afterDelete: [revalidateAfterDelete(['links'])],
  },
  fields: [
    {
      name: 'slug',
      type: 'text',
      required: true,
      unique: true,
      label: 'Slug',
      // ADR 0017 §1: a printed QR/banner points at this slug — changing it
      // would break whatever was already distributed, so it's write-once.
      access: { update: () => false },
      admin: { description: 'ბმული: samkvetlo.ge/go/{slug}. შექმნის შემდეგ ვერ შეიცვლება — შეცდომის შემთხვევაში წაშალე და თავიდან შექმენი.' },
      validate: (value: unknown) => {
        if (typeof value !== 'string' || !SHORT_LINK_SLUG_RE.test(value)) {
          return 'slug უნდა შედგებოდეს პატარა ლათინური ასოებისგან, ციფრებისგან და „-“-სგან (1–32 სიმბოლო, არა „-“-ით დაწყებული/დამთავრებული)'
        }
        return true
      },
    },
    {
      name: 'target',
      type: 'text',
      required: true,
      maxLength: 500,
      label: 'სამიზნე',
      admin: {
        description: 'შიდა გზა (მაგ. „/zarebi“) ან დაშვებული გარე საიტის https:// ბმული (Facebook, Instagram, YouTube, m.me, wa.me)',
      },
      validate: (value: unknown) => {
        if (typeof value !== 'string' || !parseShortLinkTarget(value)) {
          return 'სამიზნე არავალიდურია — იხილეთ ველის აღწერა დაშვებული ფორმატისთვის'
        }
        return true
      },
    },
    {
      name: 'utmSource',
      type: 'text',
      label: 'utm_source',
      admin: { description: 'მაგ. facebook, instagram, print, sms. მხოლოდ შიდა სამიზნეზე.' },
      validate: (value: unknown, { siblingData }: { siblingData: { target?: unknown } }) => {
        if (value === undefined || value === null || value === '') return true
        if (typeof value !== 'string' || !UTM_RE.test(value)) {
          return 'utm_source უნდა შედგებოდეს პატარა ლათინური ასოებისგან, ციფრებისგან, „_“ და „-“-სგან (≤ 40 სიმბოლო)'
        }
        const target = typeof siblingData.target === 'string' ? siblingData.target : undefined
        if (target) {
          const parsed = parseShortLinkTarget(target)
          if (parsed && parsed.kind === 'external') {
            return 'utm_source დაშვებულია მხოლოდ შიდა სამიზნეზე'
          }
        }
        return true
      },
    },
    {
      name: 'utmMedium',
      type: 'text',
      label: 'utm_medium',
      admin: { description: 'მაგ. social, qr, banner. დაშვებულია მხოლოდ utm_source-თან ერთად.' },
      validate: (value: unknown, { siblingData }: { siblingData: { utmSource?: unknown } }) => {
        if (value === undefined || value === null || value === '') return true
        if (typeof value !== 'string' || !UTM_RE.test(value)) {
          return 'utm_medium უნდა შედგებოდეს პატარა ლათინური ასოებისგან, ციფრებისგან, „_“ და „-“-სგან (≤ 40 სიმბოლო)'
        }
        if (!siblingData.utmSource) {
          return 'utm_medium დაშვებულია მხოლოდ utm_source-თან ერთად'
        }
        return true
      },
    },
    {
      name: 'utmCampaign',
      type: 'text',
      label: 'utm_campaign',
      admin: { description: 'ცარიელი — slug გამოიყენება ნაცვლად' },
      validate: (value: unknown) => {
        if (value === undefined || value === null || value === '') return true
        if (typeof value !== 'string' || !UTM_RE.test(value)) {
          return 'utm_campaign უნდა შედგებოდეს პატარა ლათინური ასოებისგან, ციფრებისგან, „_“ და „-“-სგან (≤ 40 სიმბოლო)'
        }
        return true
      },
    },
    {
      name: 'active',
      type: 'checkbox',
      defaultValue: true,
      label: 'აქტიური',
      admin: { description: 'გამორთული ბმული მთავარ გვერდზე გადამისამართებს. წაშლის ნაცვლად გამორთე.' },
    },
    {
      name: 'note',
      type: 'textarea',
      maxLength: 300,
      label: 'შენიშვნა',
      access: { read: isAdminField },
      admin: { description: 'შიდა შენიშვნა (მაგ. „ბანერი ბათუმის ტაძართან, 2026-10“) — არასოდეს ჩანს საჯაროდ' },
    },
  ],
}
