import type { Payload } from 'payload'

import type { SiteSetting } from '../../payload-types'
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
    phoneSecondary: settings.phoneSecondary ?? null,
    email: settings.email ?? null,
    address: settings.address ?? null,
    social: (settings.social ?? []).map((entry) => ({ label: entry.label, url: entry.url })),
    configuratorEnabled: settings.configuratorEnabled ?? false,
    store: toPublicStore(settings.store),
  }
}

/** `null` unless the owner opted in and both required fields are set (T5.x SEO contract). */
function toPublicStore(store: SiteSetting['store']): PublicSiteSettings['store'] {
  if (!store?.publishAddress) return null
  if (!store.streetAddress || !store.addressLocality) return null
  return {
    streetAddress: store.streetAddress,
    addressLocality: store.addressLocality,
    postalCode: store.postalCode ?? null,
  }
}
