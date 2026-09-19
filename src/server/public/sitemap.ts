import type { Payload } from 'payload'

import type { PublicSitemap } from '../../shared/contract/sitemap'
import { getCategoryPathEntries } from './category'
import { toPublicImage } from './image'

function categoryIdOf(category: unknown): number | null {
  if (typeof category === 'number') return category
  if (category && typeof category === 'object' && 'id' in category) return (category as { id: number }).id
  return null
}

/**
 * T5.x SEO contract: GET /api/public/sitemap. Every list is deliberately
 * minimal (slug/path + updatedAt, plus the one extra sitemap.xml needs per
 * product) — never a full DTO, so a field added to a collection later
 * can't leak into it without a matching change here (ADR 0005 layer 3).
 */
export async function getPublicSitemap(payload: Payload): Promise<PublicSitemap> {
  const { docs: products } = await payload.find({
    collection: 'products',
    where: { isPurchasable: { equals: true } },
    overrideAccess: false,
    depth: 1,
    limit: 0,
  })

  const sitemapProducts = products
    .filter((product): product is typeof product & { slug: string } => Boolean(product.slug))
    .map((product) => ({
      slug: product.slug,
      updatedAt: product.updatedAt,
      imageKey: toPublicImage(Array.isArray(product.gallery) ? (product.gallery[0] ?? null) : null)?.key ?? null,
    }))

  const productCategoryIds = new Set(
    products.map((product) => categoryIdOf(product.category)).filter((id): id is number => id !== null),
  )

  const categoryEntries = await getCategoryPathEntries(payload)
  const childrenOf = new Map<number, number[]>()
  for (const entry of categoryEntries) {
    if (entry.parentId === null) continue
    childrenOf.set(entry.parentId, [...(childrenOf.get(entry.parentId) ?? []), entry.id])
  }
  const hasSitemapProductCache = new Map<number, boolean>()
  function subtreeHasSitemapProduct(id: number): boolean {
    const cached = hasSitemapProductCache.get(id)
    if (cached !== undefined) return cached
    const result = productCategoryIds.has(id) || (childrenOf.get(id) ?? []).some(subtreeHasSitemapProduct)
    hasSitemapProductCache.set(id, result)
    return result
  }

  const sitemapCategories = categoryEntries
    .filter((entry) => subtreeHasSitemapProduct(entry.id))
    .map((entry) => ({ path: entry.path, updatedAt: entry.updatedAt }))

  const { docs: pages } = await payload.find({
    collection: 'pages',
    overrideAccess: false,
    depth: 0,
    limit: 0,
  })
  const sitemapPages = pages.map((page) => ({ slug: page.slug, updatedAt: page.updatedAt }))

  const { docs: portfolioItems } = await payload.find({
    collection: 'portfolio',
    overrideAccess: false,
    depth: 0,
    limit: 0,
  })
  const sitemapPortfolio = portfolioItems
    .filter((item): item is typeof item & { slug: string } => Boolean(item.slug))
    .map((item) => ({ slug: item.slug, updatedAt: item.updatedAt }))

  return {
    products: sitemapProducts,
    categories: sitemapCategories,
    pages: sitemapPages,
    portfolio: sitemapPortfolio,
  }
}
