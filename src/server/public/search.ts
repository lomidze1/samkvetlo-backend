import type { Payload } from 'payload'

import type { Paginated } from '../../shared/contract/pagination'
import type { PublicProductCard } from '../../shared/contract/product'
import { PRODUCT_PAGE_SIZE, nonNull, toPublicProductCard } from './product'

function emptyPage(): Paginated<PublicProductCard> {
  return { docs: [], page: 1, totalPages: 0, totalDocs: 0, hasNextPage: false, hasPrevPage: false, limit: PRODUCT_PAGE_SIZE }
}

/**
 * T2.8 (ADR 0004 §8): `ILIKE` on the product title, plus an exact-ish `like`
 * on a variant's SKU (`SMK-000123`) resolved back to its product — a search
 * for a printed SKU should find the product page, not just a bare number.
 */
export async function searchPublicProducts(payload: Payload, q: string): Promise<Paginated<PublicProductCard>> {
  const query = q.trim()
  if (!query) return emptyPage()

  const [byTitle, matchingVariants] = await Promise.all([
    payload.find({
      collection: 'products',
      where: { and: [{ isPurchasable: { equals: true } }, { title: { like: query } }] },
      overrideAccess: false,
      depth: 1,
      limit: PRODUCT_PAGE_SIZE,
      sort: '-createdAt',
    }),
    payload.find({
      collection: 'variants',
      where: { sku: { like: query } },
      overrideAccess: true,
      depth: 0,
      limit: PRODUCT_PAGE_SIZE,
    }),
  ])

  const productIdsFromSku = [
    ...new Set(matchingVariants.docs.map((variant) => (typeof variant.product === 'number' ? variant.product : variant.product.id))),
  ]
  const alreadyFound = new Set(byTitle.docs.map((doc) => doc.id))
  const remainingIds = productIdsFromSku.filter((id) => !alreadyFound.has(id))

  const bySku = remainingIds.length
    ? await payload.find({
        collection: 'products',
        where: { and: [{ isPurchasable: { equals: true } }, { id: { in: remainingIds } }] },
        overrideAccess: false,
        depth: 1,
        limit: PRODUCT_PAGE_SIZE,
      })
    : { docs: [] }

  const docs = [...byTitle.docs, ...bySku.docs].map(toPublicProductCard).filter(nonNull).slice(0, PRODUCT_PAGE_SIZE)

  return {
    docs,
    page: 1,
    totalPages: docs.length > 0 ? 1 : 0,
    totalDocs: docs.length,
    hasNextPage: false,
    hasPrevPage: false,
    limit: PRODUCT_PAGE_SIZE,
  }
}
