import type { Payload } from 'payload'

import type { Portfolio, Product } from '../../payload-types'
import type { PublicPortfolioItem } from '../../shared/contract/portfolio'
import { toPublicImage } from './image'

function toProductRef(product: Product | number): { slug: string; title: string } | null {
  if (typeof product === 'number' || !product.slug) return null
  return { slug: product.slug, title: product.title }
}

function toPublicPortfolioItem(doc: Portfolio): PublicPortfolioItem | null {
  if (!doc.slug) return null

  return {
    slug: doc.slug,
    church: doc.church,
    city: doc.city ?? null,
    photos: doc.photos
      .map((photo) => toPublicImage(photo))
      .filter((image): image is NonNullable<typeof image> => image !== null),
    products: (doc.products ?? [])
      .map((product) => toProductRef(product))
      .filter((ref): ref is NonNullable<typeof ref> => ref !== null),
  }
}

/** ADR 0012 §3: GET /api/public/portfolio. */
export async function getPublicPortfolio(payload: Payload): Promise<PublicPortfolioItem[]> {
  const { docs } = await payload.find({
    collection: 'portfolio',
    overrideAccess: false,
    depth: 2,
    limit: 0,
    sort: '-createdAt',
  })
  return docs.map(toPublicPortfolioItem).filter((item): item is PublicPortfolioItem => item !== null)
}

/** ADR 0012 §3: GET /api/public/portfolio/:slug. Returns null on a 404. */
export async function getPublicPortfolioBySlug(payload: Payload, slug: string): Promise<PublicPortfolioItem | null> {
  const { docs } = await payload.find({
    collection: 'portfolio',
    where: { slug: { equals: slug } },
    overrideAccess: false,
    depth: 2,
    limit: 1,
  })
  const doc = docs[0]
  return doc ? toPublicPortfolioItem(doc) : null
}
