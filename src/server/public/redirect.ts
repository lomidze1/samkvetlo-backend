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
    })
    const product = docs[0]
    if (!product?.slug) return null
    return `/product/${product.slug}`
  }

  const lastSegment = path.split('/').filter(Boolean).pop()
  if (!lastSegment) return null

  const entries = await getCategoryPathEntries(payload)
  const match = entries.find((entry) => entry.slug === lastSegment || entry.oldSlugs.includes(lastSegment))
  return match?.path ?? null
}
