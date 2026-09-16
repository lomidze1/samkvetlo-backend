import type { Payload, Where } from 'payload'

import type { Product, PublicFile, Variant } from '../../payload-types'
import type { Paginated } from '../../shared/contract/pagination'
import type {
  PublicDocument,
  PublicProduct,
  PublicProductCard,
  PublicVariant,
  PublicVideo,
} from '../../shared/contract/product'
import { resolveCategorySubtreeIds, toPublicCategoryRef } from './category'
import { toPublicImage } from './image'
import { toRichBlocks } from './richText'

export const PRODUCT_PAGE_SIZE = 24

export interface ProductListQuery {
  category?: string
  coating?: string
  size?: string
  priceMin?: number
  priceMax?: number
  tier?: 'flagship' | 'standard'
  featured?: boolean
  sort?: 'newest' | 'price-asc' | 'price-desc'
  page?: number
}

export function nonNull<T>(value: T | null): value is T {
  return value !== null
}

function emptyPage(page: number): Paginated<PublicProductCard> {
  return {
    docs: [],
    page,
    totalPages: 0,
    totalDocs: 0,
    hasNextPage: false,
    hasPrevPage: false,
    limit: PRODUCT_PAGE_SIZE,
  }
}

// D8 (see variantPricing.ts): a price stays live on the site while its
// status is 'approved' or 'needs-review' (a rate change flagged it for
// re-review, but the old confirmed price is still what we sell at).
// Exported so quoteCart/submitOrder (T3.1/T3.3) reuse this exact
// "is this variant publicly purchasable" definition instead of a second one.
export function isPriceLive(variant: Pick<Variant, 'price' | 'priceStatus'>): boolean {
  return (
    (variant.priceStatus === 'approved' || variant.priceStatus === 'needs-review') &&
    typeof variant.price === 'number'
  )
}

function toPublicVariant(variant: Variant): PublicVariant {
  const live = isPriceLive(variant)
  return {
    id: variant.id,
    sku: variant.sku ?? null,
    title: variant.title,
    coating: variant.coating,
    size: variant.size ?? null,
    weightKg: variant.weightKg ?? null,
    diameterMm: variant.diameterMm ?? null,
    heightMm: variant.heightMm ?? null,
    sortOrder: variant.sortOrder ?? 0,
    availability: variant.availability,
    leadTimeText: variant.leadTimeText ?? null,
    price: live ? (variant.price as number) : null,
    purchasable: live,
  }
}

function toPublicDocument(doc: NonNullable<Product['documents']>[number]): PublicDocument | null {
  const file: PublicFile | number = doc.file
  if (typeof file === 'number' || !file.url) return null
  // D19 exception aside, only a reviewed document is ever shown publicly —
  // productPublishValidation already requires this to publish at all, this
  // is defense in depth against a stale draft slipping through.
  if (doc.reviewedNoSecretInfo !== true) return null
  return { title: doc.title, kind: doc.kind, url: file.url, issuer: doc.issuer ?? null }
}

function toPublicVideo(video: NonNullable<Product['videos']>[number]): PublicVideo {
  return { youtubeId: video.youtubeId, poster: toPublicImage(video.poster), title: video.title ?? null }
}

function toSoundUrl(sound: Product['sound']): string | null {
  if (!sound || typeof sound === 'number') return null
  return sound.url ?? null
}

export function toPublicProductCard(product: Product): PublicProductCard | null {
  const category = toPublicCategoryRef(product.category)
  if (!product.slug || !category) return null
  const firstImage = Array.isArray(product.gallery) ? (product.gallery[0] ?? null) : null

  return {
    slug: product.slug,
    title: product.title,
    category,
    tier: product.tier,
    featured: Boolean(product.featured),
    image: toPublicImage(firstImage),
    minPrice: product.minPrice ?? null,
    isPurchasable: Boolean(product.isPurchasable),
  }
}

async function fetchVariantsForProduct(payload: Payload, productId: number): Promise<PublicVariant[]> {
  const { docs } = await payload.find({
    collection: 'variants',
    where: { product: { equals: productId } },
    overrideAccess: false,
    depth: 0,
    limit: 0,
    sort: 'sortOrder',
  })
  return docs.map(toPublicVariant)
}

async function toPublicProduct(payload: Payload, product: Product): Promise<PublicProduct | null> {
  const category = toPublicCategoryRef(product.category)
  if (!product.slug || !category) return null

  const variants = await fetchVariantsForProduct(payload, product.id)
  const gallery = (product.gallery ?? []).map((image) => toPublicImage(image)).filter(nonNull)
  const documents = (product.documents ?? []).map(toPublicDocument).filter(nonNull)
  const videos = (product.videos ?? []).map(toPublicVideo)

  return {
    slug: product.slug,
    title: product.title,
    category,
    tier: product.tier,
    featured: Boolean(product.featured),
    description: toRichBlocks(product.description),
    features: (product.features ?? []).map((feature) => ({ label: feature.label, value: feature.value })),
    gallery,
    whyQuality: product.whyQuality ? toRichBlocks(product.whyQuality) : null,
    documents,
    videos,
    sound: toSoundUrl(product.sound),
    variants,
    minPrice: product.minPrice ?? null,
    isPurchasable: Boolean(product.isPurchasable),
  }
}

/** ADR 0012 §3: GET /api/public/products/:slug. Returns null on a 404. */
export async function getPublicProductBySlug(payload: Payload, slug: string): Promise<PublicProduct | null> {
  const { docs } = await payload.find({
    collection: 'products',
    where: { slug: { equals: slug } },
    overrideAccess: false,
    depth: 2,
    limit: 1,
  })
  const product = docs[0]
  return product ? toPublicProduct(payload, product) : null
}

/**
 * ADR 0012 §3: GET /api/public/products. `isPurchasable: false` and drafts
 * never come back — the former is filtered here, the latter by
 * publicReadPublished (ADR 0005).
 */
export async function getPublicProductCards(
  payload: Payload,
  query: ProductListQuery,
): Promise<Paginated<PublicProductCard>> {
  const page = query.page && query.page > 0 ? Math.floor(query.page) : 1
  const and: Where[] = [{ isPurchasable: { equals: true } }]

  if (query.tier) and.push({ tier: { equals: query.tier } })
  if (query.featured !== undefined) and.push({ featured: { equals: query.featured } })
  if (typeof query.priceMin === 'number') and.push({ minPrice: { greater_than_equal: query.priceMin } })
  if (typeof query.priceMax === 'number') and.push({ minPrice: { less_than_equal: query.priceMax } })

  if (query.category) {
    const subtreeIds = await resolveCategorySubtreeIds(payload, query.category)
    if (!subtreeIds) return emptyPage(page)
    and.push({ category: { in: subtreeIds } })
  }

  if (query.coating || query.size) {
    const variantAnd: Where[] = []
    if (query.coating) variantAnd.push({ coating: { equals: query.coating } })
    if (query.size) variantAnd.push({ size: { equals: query.size } })
    const { docs: matchingVariants } = await payload.find({
      collection: 'variants',
      where: { and: variantAnd },
      limit: 0,
      depth: 0,
      overrideAccess: true,
    })
    const productIds = [
      ...new Set(
        matchingVariants.map((variant) => (typeof variant.product === 'number' ? variant.product : variant.product.id)),
      ),
    ]
    if (productIds.length === 0) return emptyPage(page)
    and.push({ id: { in: productIds } })
  }

  const sort =
    query.sort === 'price-asc' ? 'minPrice' : query.sort === 'price-desc' ? '-minPrice' : '-createdAt'

  const result = await payload.find({
    collection: 'products',
    where: { and },
    overrideAccess: false,
    depth: 1,
    page,
    limit: PRODUCT_PAGE_SIZE,
    sort,
  })

  const docs = result.docs.map(toPublicProductCard).filter(nonNull)
  return {
    docs,
    page: result.page ?? page,
    totalPages: result.totalPages ?? 1,
    totalDocs: result.totalDocs ?? docs.length,
    hasNextPage: result.hasNextPage ?? false,
    hasPrevPage: result.hasPrevPage ?? false,
    limit: result.limit ?? PRODUCT_PAGE_SIZE,
  }
}
