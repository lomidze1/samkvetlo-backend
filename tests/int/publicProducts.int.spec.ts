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
})
