// T5.x SEO contract: GET /api/public/sitemap mapper.
// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { getPublicSitemap } from '@/server/public/sitemap'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload

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

const cleanup: { collection: 'categories' | 'products' | 'pages'; id: number }[] = []

async function makePurchasable(productId: number): Promise<void> {
  const { docs: variants } = await payload.find({
    collection: 'variants',
    where: { product: { equals: productId } },
    limit: 1,
    overrideAccess: true,
  })
  await payload.update({
    collection: 'variants',
    id: variants[0]!.id,
    data: { price: 1000, priceStatus: 'approved' },
    overrideAccess: true,
  })
}

describe('GET /api/public/sitemap mapper (T5.x SEO contract)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    for (const { collection, id } of cleanup) {
      await payload.delete({ collection, id, overrideAccess: true }).catch(() => undefined)
    }
  })

  it('excludes a category with no purchasable products anywhere in its subtree', async () => {
    const suffix = `${Date.now()}-${Math.random()}`
    const emptyCategory = await payload.create({
      collection: 'categories',
      data: { name: `sitemap-empty-cat-${suffix}` },
      overrideAccess: true,
    })
    cleanup.push({ collection: 'categories', id: emptyCategory.id })

    const sitemap = await getPublicSitemap(payload)
    expect(sitemap.categories.some((c) => c.path === `/${emptyCategory.slug}`)).toBe(false)
  })

  it('includes a parent category via a purchasable product on a child, and the product with its image key', async () => {
    const suffix = `${Date.now()}-${Math.random()}`
    const parent = await payload.create({
      collection: 'categories',
      data: { name: `sitemap-parent-${suffix}` },
      overrideAccess: true,
    })
    cleanup.push({ collection: 'categories', id: parent.id })
    const child = await payload.create({
      collection: 'categories',
      data: { name: `sitemap-child-${suffix}`, parent: parent.id },
      overrideAccess: true,
    })
    cleanup.push({ collection: 'categories', id: child.id })

    const product = await payload.create({
      collection: 'products',
      data: {
        title: `sitemap-product-${suffix}`,
        category: child.id,
        tier: 'standard',
        description: EMPTY_RICH_TEXT,
        _status: 'published',
      },
      overrideAccess: true,
    })
    cleanup.push({ collection: 'products', id: product.id })
    await makePurchasable(product.id)

    const sitemap = await getPublicSitemap(payload)
    expect(sitemap.categories.map((c) => c.path)).toEqual(
      expect.arrayContaining([`/${parent.slug}/${child.slug}`, `/${parent.slug}`]),
    )
    const sitemapProduct = sitemap.products.find((p) => p.slug === product.slug)
    expect(sitemapProduct).toBeTruthy()
    expect(sitemapProduct!.imageKey).toBeNull()
  })

  it('excludes a published product that is not purchasable', async () => {
    const suffix = `${Date.now()}-${Math.random()}`
    const category = await payload.create({
      collection: 'categories',
      data: { name: `sitemap-notpurchasable-cat-${suffix}` },
      overrideAccess: true,
    })
    cleanup.push({ collection: 'categories', id: category.id })
    const product = await payload.create({
      collection: 'products',
      data: {
        title: `sitemap-notpurchasable-${suffix}`,
        category: category.id,
        tier: 'standard',
        description: EMPTY_RICH_TEXT,
        _status: 'published',
      },
      overrideAccess: true,
    })
    cleanup.push({ collection: 'products', id: product.id })

    const sitemap = await getPublicSitemap(payload)
    expect(sitemap.products.some((p) => p.slug === product.slug)).toBe(false)
    expect(sitemap.categories.some((c) => c.path === `/${category.slug}`)).toBe(false)
  })

  it('code review (ADR 0005): excludes a DRAFT product even when isPurchasable is true', async () => {
    const suffix = `${Date.now()}-${Math.random()}`
    const category = await payload.create({
      collection: 'categories',
      data: { name: `sitemap-draft-purchasable-cat-${suffix}` },
      overrideAccess: true,
    })
    cleanup.push({ collection: 'categories', id: category.id })
    // Never published — `recomputeProductPricing` denormalizes
    // isPurchasable/minPrice onto the *live* row directly (db.updateOne,
    // bypassing versions/drafts) whenever its variant's price changes, so a
    // draft product's row can end up with isPurchasable: true despite
    // `_status` staying 'draft'. The sitemap must still exclude it — this
    // proves `publicReadPublished`'s `_status: 'published'` filter, not
    // just the isPurchasable filter, is what's actually protecting it.
    const product = await payload.create({
      collection: 'products',
      data: {
        title: `sitemap-draft-purchasable-${suffix}`,
        category: category.id,
        tier: 'standard',
        description: EMPTY_RICH_TEXT,
        _status: 'draft',
      },
      overrideAccess: true,
    })
    cleanup.push({ collection: 'products', id: product.id })
    await makePurchasable(product.id)

    const isPurchasableNow = (
      await payload.findByID({ collection: 'products', id: product.id, overrideAccess: true })
    ).isPurchasable
    expect(isPurchasableNow).toBe(true)

    const sitemap = await getPublicSitemap(payload)
    expect(sitemap.products.some((p) => p.slug === product.slug)).toBe(false)
    expect(sitemap.categories.some((c) => c.path === `/${category.slug}`)).toBe(false)
  })

  it('includes the privacy page (self-seeded, not dependent on another file having run the seed script)', async () => {
    const { docs: existing } = await payload.find({
      collection: 'pages',
      where: { slug: { equals: 'privacy' } },
      overrideAccess: true,
      limit: 1,
    })
    if (!existing[0]) {
      const created = await payload.create({
        collection: 'pages',
        data: { slug: 'privacy', title: 'კონფიდენციალურობა', content: EMPTY_RICH_TEXT },
        overrideAccess: true,
      })
      cleanup.push({ collection: 'pages', id: created.id })
    }

    const sitemap = await getPublicSitemap(payload)
    expect(sitemap.pages.map((p) => p.slug)).toContain('privacy')
  })
})
