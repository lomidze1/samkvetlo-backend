import type { Payload } from 'payload'

import type { PublicSiteSettings } from '../../shared/contract/siteSettings'

/**
 * ADR 0012 §3: GET /api/public/site-settings. `overrideAccess: false` +
 * explicit key-by-key mapping — this is belt-and-suspenders on top of
 * Payload's own field-level access (ADR 0005 layer 2), which already hides
 * ownerEmails/ownerPhones/notifyCustomer/shareLinkTtlDays from an
 * anonymous read of this global.
 */
export async function getPublicSiteSettings(payload: Payload): Promise<PublicSiteSettings> {
  const settings = await payload.findGlobal({
    slug: 'site-settings',
    overrideAccess: false,
  })

  return {
    phone: settings.phone ?? null,
    email: settings.email ?? null,
    address: settings.address ?? null,
    social: (settings.social ?? []).map((entry) => ({ label: entry.label, url: entry.url })),
    configuratorEnabled: settings.configuratorEnabled ?? false,
  }
}
