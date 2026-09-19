// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012)
import { z } from 'zod'

// ADR 0005 layer 2: ownerEmails/ownerPhones/notifyCustomer/shareLinkTtlDays
// are admin-only fields on the same global — they never reach this DTO.
export const PublicSiteSettingsSchema = z.strictObject({
  phone: z.string().nullable(),
  // X2 (owner-checklist 2026-09-18): calls only, no Viber/WhatsApp — unlike
  // `phone`. Additive field, no CONTRACT_VERSION bump.
  phoneSecondary: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  social: z.array(z.strictObject({ label: z.string(), url: z.string() })),
  // ADR 0010 / T2.3: gates the home page configurator teaser. Off by
  // default until the foundry confirms the bell SVG.
  configuratorEnabled: z.boolean(),
  // T5.x SEO contract: structured LocalBusiness address. `null` unless the
  // owner opted in (site-settings.store.publishAddress) AND both required
  // fields are non-empty — never derived from the free-text `address`.
  store: z
    .strictObject({
      streetAddress: z.string(),
      addressLocality: z.string(),
      postalCode: z.string().nullable(),
    })
    .nullable(),
})
export type PublicSiteSettings = z.infer<typeof PublicSiteSettingsSchema>
