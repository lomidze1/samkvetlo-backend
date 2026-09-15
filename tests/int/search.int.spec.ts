// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { searchPublicProducts } from '@/server/public/search'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload
const productIds: (number | string)[] = []
const categoryIds: (number | string)[] = []

const EMPTY_RICH_TEXT = {
  root: {
    type: 'root' as const,
    direction: null,
    format: '' as const,
    indent: 0,
    version: 1 as const,
    children: [
      {
        type: 'paragraph' as const,
        direction: null,
        format: '' as const,
        indent: 0,
        version: 1 as const,
        children: [{ type: 'text' as const, detail: 0, format: 0, mode: 'normal' as const, style: '', text: 'x', version: 1 as const }],
      },
    ],
  },
}

describe('search (T2.8, ADR 0004 §8)', () => {
  let bellSlug: string
  let bellSku: string

  beforeAll(async () => {
    payload = await getPayload({ config: await config })

    const category = await payload.create({
      collection: 'categories',
      data: { name: `ძებნის-კატ ${Date.now()}-${Math.random()}` },
    })
    categoryIds.push(category.id)

    const product = await payload.create({
      collection: 'products',
      data: {
        title: `ძებნის ტესტის ზარი ${Date.now()}`,
        category: category.id,
        tier: 'standard',
        description: EMPTY_RICH_TEXT,
        _status: 'published',
      },
    })
    productIds.push(product.id)
    bellSlug = product.slug!

    const { docs: variants } = await payload.find({ collection: 'variants', where: { product: { equals: product.id } } })
    const variant = variants[0]!
    bellSku = variant.sku!
    await payload.update({
      collection: 'variants',
      id: variant.id,
      data: { price: 1000, priceStatus: 'approved' },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    for (const id of productIds) {
      await payload.delete({ collection: 'variants', where: { product: { equals: id } } }).catch(() => undefined)
      await payload.delete({ collection: 'products', id }).catch(() => undefined)
    }
    for (const id of categoryIds) await payload.delete({ collection: 'categories', id }).catch(() => undefined)
  })

  it('finds a product by a substring of its title', async () => {
    const result = await searchPublicProducts(payload, 'ძებნის ტესტის ზარი')
    expect(result.docs.map((d) => d.slug)).toContain(bellSlug)
  })

  it('finds the product via its variant SKU', async () => {
    const result = await searchPublicProducts(payload, bellSku)
    expect(result.docs.map((d) => d.slug)).toContain(bellSlug)
  })

  it('returns an empty page for no match, without throwing', async () => {
    const result = await searchPublicProducts(payload, 'ვერასდროს-ვერაფერი-ვერსად-XYZ123')
    expect(result.docs).toEqual([])
    expect(result.totalDocs).toBe(0)
  })

  it('returns an empty page for a blank query', async () => {
    const result = await searchPublicProducts(payload, '   ')
    expect(result.docs).toEqual([])
  })

  it('treats % and _ as literal characters, not ILIKE wildcards (code review)', async () => {
    // Unescaped, `%` alone would ILIKE-match every published product's
    // title (`%%%` = "anything"), returning results for a query that
    // matches nothing literally.
    const result = await searchPublicProducts(payload, '%')
    expect(result.docs).toEqual([])
  })
})
