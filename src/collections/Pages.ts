import type { CollectionConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'
import { publicRead } from '../access/publicRead'

// Architecture §9: the fixed set of static content pages (rich text).
// A general CMS-style page tree isn't needed for these five.
const PAGE_SLUGS = [
  { label: 'როგორ ვმუშაობთ', value: 'how-we-work' },
  { label: 'ჩვენს შესახებ', value: 'about' },
  { label: 'მიწოდება', value: 'delivery' },
  { label: 'კონტაქტი', value: 'contact' },
  { label: 'კონფიდენციალურობა', value: 'privacy' },
] as const

export const Pages: CollectionConfig = {
  slug: 'pages',
  labels: {
    singular: 'გვერდი',
    plural: 'გვერდები',
  },
  admin: {
    useAsTitle: 'title',
  },
  access: {
    read: publicRead,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [
    {
      name: 'slug',
      type: 'select',
      required: true,
      unique: true,
      label: 'გვერდი',
      options: [...PAGE_SLUGS],
    },
    { name: 'title', type: 'text', required: true, label: 'სათაური' },
    { name: 'content', type: 'richText', required: true, label: 'ტექსტი' },
  ],
}
