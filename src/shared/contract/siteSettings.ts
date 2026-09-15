// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012)
import { z } from 'zod'

// ADR 0005 layer 2: ownerEmails/ownerPhones/notifyCustomer/shareLinkTtlDays
// are admin-only fields on the same global — they never reach this DTO.
export const PublicSiteSettingsSchema = z.strictObject({
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  social: z.array(z.strictObject({ label: z.string(), url: z.string() })),
})
export type PublicSiteSettings = z.infer<typeof PublicSiteSettingsSchema>
