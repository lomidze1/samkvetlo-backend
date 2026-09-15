import type { PayloadRequest } from 'payload'

import { PaginatedSchema } from '../../shared/contract/pagination'
import { PublicProductCardSchema, PublicProductSchema, TIER_VALUES } from '../../shared/contract/product'
import { getPublicProductBySlug, getPublicProductCards, type ProductListQuery } from '../../server/public/product'
import { publicEndpoint, PublicNotFoundError } from './publicEndpoint'

const SORT_VALUES = ['newest', 'price-asc', 'price-desc'] as const

function parseListQuery(req: PayloadRequest): ProductListQuery {
  const url = new URL(req.url ?? '', 'http://localhost')
  const params = url.searchParams

  const tier = params.get('tier')
  const sort = params.get('sort')
  const featured = params.get('featured')
  const priceMin = params.get('priceMin')
  const priceMax = params.get('priceMax')
  const page = params.get('page')

  return {
    category: params.get('category') ?? undefined,
    coating: params.get('coating') ?? undefined,
    size: params.get('size') ?? undefined,
    tier: (TIER_VALUES as readonly string[]).includes(tier ?? '') ? (tier as ProductListQuery['tier']) : undefined,
    sort: (SORT_VALUES as readonly string[]).includes(sort ?? '') ? (sort as ProductListQuery['sort']) : undefined,
    featured: featured === 'true' ? true : featured === 'false' ? false : undefined,
    priceMin: priceMin !== null && Number.isFinite(Number(priceMin)) ? Number(priceMin) : undefined,
    priceMax: priceMax !== null && Number.isFinite(Number(priceMax)) ? Number(priceMax) : undefined,
    page: page !== null && Number.isFinite(Number(page)) ? Number(page) : undefined,
  }
}

export const productsListEndpoint = publicEndpoint({
  path: '/public/products',
  method: 'get',
  scope: 'read',
  output: PaginatedSchema(PublicProductCardSchema),
  handler: async (req) => getPublicProductCards(req.payload, parseListQuery(req)),
})

export const productBySlugEndpoint = publicEndpoint({
  path: '/public/products/:slug',
  method: 'get',
  scope: 'read',
  output: PublicProductSchema,
  handler: async (req) => {
    const slug = req.routeParams?.slug
    if (typeof slug !== 'string') throw new PublicNotFoundError()
    const product = await getPublicProductBySlug(req.payload, slug)
    if (!product) throw new PublicNotFoundError()
    return product
  },
})

