import type { Payload } from 'payload'

import { getCategoryPathEntries } from './category'

/**
 * T5.4 (301/308 redirects). `path` for `type=product` is the product's
 * slug (old or current); for `type=category` it's a full path or bare
 * slug — only the last segment is used, since category slugs are globally
 * unique (ADR 0002). Returns `null` on no match (caller 404s).
 *
 * `overrideAccess: false` on the products query means an unpublished
 * product's slug — old or current — never resolves (publicReadPublished).
 */
export async function resolvePublicRedirect(
  payload: Payload,
  type: 'product' | 'category',
  path: string,
): Promise<string | null> {
  if (type === 'product') {
    const { docs } = await payload.find({
      collection: 'products',
      where: { or: [{ slug: { equals: path } }, { 'oldSlugs.slug': { equals: path } }] },
      overrideAccess: false,
      depth: 0,
      limit: 1,
      // Code review M1: with the self-heal in trackOldSlugs.ts this query
      // should never actually match more than one doc, but `limit: 1`
      // without a sort would otherwise let the database pick an arbitrary
      // row when it did — most-recently-updated wins, deterministically.
      sort: '-updatedAt',
    })
    const product = docs[0]
    if (!product?.slug) return null
    const to = `/product/${product.slug}`
    // Code review finding: a lookup that happens to match the product's
    // *current* slug (not an old one) resolves to its own URL — a 308
    // there would redirect to itself forever. Only an old-slug match
    // should ever produce a redirect.
    if (to === `/product/${path}`) return null
    return to
  }

  const lastSegment = path.split('/').filter(Boolean).pop()
  if (!lastSegment) return null

  const entries = await getCategoryPathEntries(payload)
  const match = entries.find((entry) => entry.slug === lastSegment || entry.oldSlugs.includes(lastSegment))
  if (!match) return null

  // Same self-redirect guard for categories: `path` may arrive as a bare
  // slug or a full nested path, so it's normalized (leading `/`) before
  // comparing against the resolved full path.
  const normalizedInput = path.startsWith('/') ? path : `/${path}`
  if (match.path === normalizedInput) return null
  return match.path
}
