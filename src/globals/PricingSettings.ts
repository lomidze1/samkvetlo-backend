import type { GlobalConfig } from 'payload'

import { isAdmin } from '../access/isAdmin'

// ADR 0006: global pricing parameters. Admin-only (never exposed publicly —
// this is exactly the data ADR 0005 keeps off the site).
export const PricingSettings: GlobalConfig = {
  slug: 'pricing-settings',
  label: 'ფასწარმოქმნის პარამეტრები',
  access: {
    read: isAdmin,
    update: isAdmin,
  },
  fields: [
    {
      // 2026-09-14: owner confirmed P% = 30 (see ADR 0006).
      name: 'pPercent',
      type: 'number',
      required: true,
      label: 'P% (ფასნამატი)',
      defaultValue: 30,
      min: 0,
    },
    {
      name: 'pConfirmed',
      type: 'checkbox',
      label: 'P% დადასტურებულია',
      defaultValue: true,
    },
    {
      name: 'categoryOverrides',
      type: 'array',
      label: 'P%-ის გამონაკლისები კატეგორიით',
      fields: [
        { name: 'category', type: 'relationship', relationTo: 'categories', required: true, label: 'კატეგორია' },
        { name: 'pPercent', type: 'number', required: true, label: 'P%', min: 0 },
      ],
    },
    { name: 'minMarkupUsd', type: 'number', required: true, label: 'მინ. ფასნამატი ($)', defaultValue: 1000 },
    { name: 'maxMarkupUsd', type: 'number', required: true, label: 'მაქს. ფასნამატი ($)', defaultValue: 2500 },
    {
      // 2026-09-14: owner confirmed rounding to the nearest 10 ₾.
      name: 'roundingStepGel',
      type: 'number',
      required: true,
      label: 'დამრგვალება (₾)',
      defaultValue: 10,
      min: 1,
    },
    { name: 'defaultBankFeePct', type: 'number', required: true, label: 'საბანკო საკომისიო % (default)', defaultValue: 1, min: 0 },
    { name: 'defaultBufferPct', type: 'number', required: true, label: 'ბუფერი % (default)', defaultValue: 5, min: 0 },
    { name: 'thresholdYellowPct', type: 'number', required: true, label: '🟡 ზღვარი (%)', defaultValue: 100, min: 0 },
    { name: 'thresholdRedPct', type: 'number', required: true, label: '🔴 ზღვარი (%)', defaultValue: 150, min: 0 },
    { name: 'needsReviewPct', type: 'number', required: true, label: 'N% (კურსის ცვლილება)', defaultValue: 3, min: 0 },
  ],
}
