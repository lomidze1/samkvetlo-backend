import type { Payload } from 'payload'

import { buildShortLinkHref, type PublicShortLink } from '../../shared/contract/shortLink'

/**
 * ADR 0017 §2: GET /api/public/short-links — every *active* link, `href`
 * already built with UTM (frontend needs no UTM logic of its own). One
 * list, not a per-slug endpoint, so an unknown slug never reaches the
 * backend (§2's "why a list" note) — the frontend caches this whole
 * response under the `links` tag.
 */
export async function getPublicShortLinks(payload: Payload): Promise<PublicShortLink[]> {
  const { docs } = await payload.find({
    collection: 'short-links',
    where: { active: { equals: true } },
    overrideAccess: false,
    depth: 0,
    limit: 0,
    select: { slug: true, target: true, utmSource: true, utmMedium: true, utmCampaign: true },
  })

  return docs
    .filter((doc) => Boolean(doc.slug) && Boolean(doc.target))
    .map((doc) => ({
      slug: doc.slug as string,
      href: buildShortLinkHref({
        slug: doc.slug as string,
        target: doc.target as string,
        utmSource: doc.utmSource,
        utmMedium: doc.utmMedium,
        utmCampaign: doc.utmCampaign,
      }),
    }))
}
