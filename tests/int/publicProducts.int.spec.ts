// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { getPublicProductBySlug, getPublicProductCards } from '@/server/public/product'
import { slugify } from '@/lib/translit'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

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

async function createCategory() {
  const category = await payload.create({
    collection: 'categories',
    data: { name: `DTO-კატ ${Date.now()}-${Math.random()}` },
  })
  categoryIds.push(category.id)
  return category
}

describe('public product DTO (T1.9, ADR 0012 §3)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 200 })))
  })

  afterAll(async () => {
    vi.unstubAllGlobals()
    for (const id of productIds) {
      await payload.delete({ collection: 'variants', where: { product: { equals: id } } }).catch(() => undefined)
      await payload.delete({ collection: 'products', id }).catch(() => undefined)
    }
    for (const id of categoryIds) await payload.delete({ collection: 'categories', id }).catch(() => undefined)
  })

  it('the product list never includes a draft or an unpurchasable (unapproved-price) product', async () => {
    const category = await createCategory()

    const draft = await payload.create({
      collection: 'products',
      data: { title: `დრაფტი-DTO ${Date.now()}`, category: category.id, tier: 'standard', description: EMPTY_RICH_TEXT, _status: 'draft' },
    })
    productIds.push(draft.id)

    const unapproved = await payload.create({
      collection: 'products',
      data: { title: `დაუდასტურებელი-DTO ${Date.now()}`, category: category.id, tier: 'standard', description: EMPTY_RICH_TEXT, _status: 'published' },
    })
    productIds.push(unapproved.id)

    const { docs: cards } = await getPublicProductCards(payload, {})
    const slugs = cards.map((card) => card.slug)
    expect(slugs).not.toContain(draft.slug)
    expect(slugs).not.toContain(unapproved.slug)
  })

  it('the product detail DTO includes diameterMm/heightMm on a variant and a {slug,name} category ref', async () => {
    const category = await createCategory()
    const product = await payload.create({
      collection: 'products',
      data: {
        title: `DTO ზარი ${Date.now()}`,
        category: category.id,
        tier: 'standard',
        description: EMPTY_RICH_TEXT,
        _status: 'published',
      },
    })
    productIds.push(product.id)

    const { docs: variants } = await payload.find({ collection: 'variants', where: { product: { equals: product.id } } })
    const variant = variants[0]!
    await payload.update({
      collection: 'variants',
      id: variant.id,
      data: { diameterMm: 300, heightMm: 350, price: 5000, priceStatus: 'approved' },
      overrideAccess: true,
    })

    const dto = await getPublicProductBySlug(payload, product.slug!)
    expect(dto).toBeTruthy()
    expect(dto!.category).toEqual({ slug: category.slug, name: category.name })
    expect(dto!.variants[0]).toMatchObject({ diameterMm: 300, heightMm: 350, price: 5000, purchasable: true })
    expect(dto!.isPurchasable).toBe(true)
    expect(dto!.minPrice).toBe(5000)
  })

  it("getPublicProductBySlug returns null for an unknown slug (endpoint turns this into a 404)", async () => {
    expect(await getPublicProductBySlug(payload, slugify('არარსებული პროდუქტი XYZ'))).toBeNull()
  })

  it('T2.4: filtering by a parent category also returns products filed under its child category', async () => {
    const parent = await createCategory()
    const child = await payload.create({
      collection: 'categories',
      data: { name: `DTO-ქვეკატ ${Date.now()}-${Math.random()}`, parent: parent.id },
    })
    categoryIds.push(child.id)

    const product = await payload.create({
      collection: 'products',
      data: {
        title: `DTO ქვეშვილი ${Date.now()}`,
        category: child.id,
        tier: 'standard',
        description: EMPTY_RICH_TEXT,
        _status: 'published',
      },
    })
    productIds.push(product.id)
    const { docs: variants } = await payload.find({ collection: 'variants', where: { product: { equals: product.id } } })
    await payload.update({
      collection: 'variants',
      id: variants[0]!.id,
      data: { price: 1000, priceStatus: 'approved' },
      overrideAccess: true,
    })

    const { docs: byParent } = await getPublicProductCards(payload, { category: parent.slug! })
    expect(byParent.map((card) => card.slug)).toContain(product.slug)

    const { docs: byChild } = await getPublicProductCards(payload, { category: child.slug! })
    expect(byChild.map((card) => card.slug)).toContain(product.slug)
  })

  it('an unknown category slug returns an empty page, not every product', async () => {
    const { docs, totalDocs } = await getPublicProductCards(payload, { category: 'ვერასდროს-არსებული-კატეგორია' })
    expect(docs).toEqual([])
    expect(totalDocs).toBe(0)
  })

  // Code review (Phase 2): `sort=price-asc/price-desc` (T2.4) had no test
  // anywhere actually asserting the resulting order — the frontend e2e only
  // checked the URL and a 200 status, and the dev seed has just one product
  // per category, so it can't exercise ordering either. This creates its
  // own three differently-priced products to cover the real behavior.
  it('sort: price-asc/price-desc order products by minPrice within a category', async () => {
    const category = await createCategory()
    const prices = [3000, 1000, 2000]
    const slugs: string[] = []
    for (const price of prices) {
      const product = await payload.create({
        collection: 'products',
        data: {
          title: `DTO ფასდალაგება ${price} ${Date.now()}-${Math.random()}`,
          category: category.id,
          tier: 'standard',
          description: EMPTY_RICH_TEXT,
          _status: 'published',
        },
      })
      productIds.push(product.id)
      slugs.push(product.slug!)
      const { docs: variants } = await payload.find({ collection: 'variants', where: { product: { equals: product.id } } })
      await payload.update({
        collection: 'variants',
        id: variants[0]!.id,
        data: { price, priceStatus: 'approved' },
        overrideAccess: true,
      })
    }

    const ascending = await getPublicProductCards(payload, { category: category.slug!, sort: 'price-asc' })
    expect(ascending.docs.filter((card) => slugs.includes(card.slug)).map((card) => card.minPrice)).toEqual([1000, 2000, 3000])

    const descending = await getPublicProductCards(payload, { category: category.slug!, sort: 'price-desc' })
    expect(descending.docs.filter((card) => slugs.includes(card.slug)).map((card) => card.minPrice)).toEqual([3000, 2000, 1000])
  })
})
