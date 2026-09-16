// See media.int.spec.ts: file-type needs the real Node Uint8Array realm.
// @vitest-environment node
import fs from 'node:fs/promises'
import path from 'node:path'
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { Products } from '@/collections/Products'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload
const productIds: (number | string)[] = []
const categoryIds: (number | string)[] = []
const publicFileIds: (number | string)[] = []
const adminUserIds: (number | string)[] = []

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
        children: [
          {
            type: 'text' as const,
            detail: 0,
            format: 0,
            mode: 'normal' as const,
            style: '',
            text: 'ტესტის აღწერა',
            version: 1 as const,
          },
        ],
      },
    ],
  },
}

let categoryCounter = 0

async function createCategory() {
  categoryCounter += 1
  // Each test needs its own category — `name` slugifies to a unique slug.
  const category = await payload.create({
    collection: 'categories',
    data: { name: `ზარები ${categoryCounter}` },
  })
  categoryIds.push(category.id)
  return category
}

async function createPublicPdf() {
  const data = await fs.readFile(path.resolve(__dirname, '../fixtures/sample.pdf'))
  const doc = await payload.create({
    collection: 'public-files',
    data: {},
    file: { data, mimetype: 'application/pdf', name: 'certificate.pdf', size: data.length },
  })
  publicFileIds.push(doc.id)
  return doc
}

describe('products + variants (T1.3, ADR 0002 / 0009)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    // Children before parents: variants FK-reference products, products
    // FK-reference categories.
    for (const id of productIds) {
      await payload.delete({ collection: 'variants', where: { product: { equals: id } } })
      await payload.delete({ collection: 'products', id })
    }
    for (const id of categoryIds) await payload.delete({ collection: 'categories', id })
    for (const id of publicFileIds) await payload.delete({ collection: 'public-files', id })
    for (const id of adminUserIds) await payload.delete({ collection: 'users', id })
  })

  it('1) a new product gets exactly one default variant', async () => {
    const category = await createCategory()
    const product = await payload.create({
      collection: 'products',
      data: { title: 'ტესტის ზარი', category: category.id, tier: 'standard', description: EMPTY_RICH_TEXT },
    })
    productIds.push(product.id)

    const { docs: variants } = await payload.find({
      collection: 'variants',
      where: { product: { equals: product.id } },
    })
    expect(variants).toHaveLength(1)
    expect(variants[0]?.title).toBe('სტანდარტული')
  })

  it('2) approving a variant with price 7610 updates the product minPrice/isPurchasable', async () => {
    const category = await createCategory()
    const product = await payload.create({
      collection: 'products',
      data: { title: 'ტესტის ბარძიმი', category: category.id, tier: 'standard', description: EMPTY_RICH_TEXT },
    })
    productIds.push(product.id)

    const { docs: variants } = await payload.find({
      collection: 'variants',
      where: { product: { equals: product.id } },
    })
    const variant = variants[0]!

    // Simulates what the approve endpoint (T1.4) does: writes price +
    // priceStatus via the Local API with overrideAccess (field access
    // blocks this from a normal request — see assertion 3 below).
    await payload.update({
      collection: 'variants',
      id: variant.id,
      data: { price: 7610, priceStatus: 'approved' },
      overrideAccess: true,
    })

    const updatedProduct = await payload.findByID({ collection: 'products', id: product.id })
    expect(updatedProduct.minPrice).toBe(7610)
    expect(updatedProduct.isPurchasable).toBe(true)
  })

  it('3) price cannot be changed by a normal (non-overrideAccess) update', async () => {
    const category = await createCategory()
    const product = await payload.create({
      collection: 'products',
      data: { title: 'ტესტის ჭურჭელი', category: category.id, tier: 'standard', description: EMPTY_RICH_TEXT },
    })
    productIds.push(product.id)

    const { docs: variants } = await payload.find({
      collection: 'variants',
      where: { product: { equals: product.id } },
    })
    const variant = variants[0]!

    // Admin-level access (not overrideAccess) still can't touch `price` —
    // only the field-level access.update lock does that (ADR 0006 §4).
    const admin = await payload.create({
      collection: 'users',
      data: { email: `test-admin-${Date.now()}@samkvetlo.local`, password: 'test-password-16chars' },
    })
    adminUserIds.push(admin.id)

    await payload.update({
      collection: 'variants',
      id: variant.id,
      data: { price: 99_999 },
      overrideAccess: false,
      user: admin,
    })

    const reloaded = await payload.findByID({ collection: 'variants', id: variant.id })
    expect(reloaded.price).not.toBe(99_999)
  })

  it('4) a flagship product cannot publish without whyQuality and ≥ 4 gallery photos', async () => {
    const category = await createCategory()
    await expect(
      payload.create({
        collection: 'products',
        data: {
          title: 'ტესტის დიდი ზარი',
          category: category.id,
          tier: 'flagship',
          _status: 'published',
          description: EMPTY_RICH_TEXT,
        },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('5) a product cannot publish with a document that is not reviewed for secret info', async () => {
    const category = await createCategory()
    const pdf = await createPublicPdf()
    await expect(
      payload.create({
        collection: 'products',
        data: {
          title: 'ტესტის სერტიფიკატი',
          category: category.id,
          tier: 'standard',
          _status: 'published',
          description: EMPTY_RICH_TEXT,
          documents: [
            { title: 'სერტიფიკატი', kind: 'certificate', file: pdf.id, reviewedNoSecretInfo: false },
          ],
        },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('6) documents[].issuer is a plain text field, not a relationship (D19 / ADR 0005)', () => {
    const documentsField = Products.fields.find((field) => 'name' in field && field.name === 'documents')
    if (!documentsField || !('fields' in documentsField)) {
      throw new Error('Products.documents field not found')
    }
    const issuerField = documentsField.fields.find((field) => 'name' in field && field.name === 'issuer')
    expect(issuerField && 'type' in issuerField ? issuerField.type : undefined).toBe('text')
  })

  // Code review fix (T1.1–T1.8): publicRead (`() => true`) let an anonymous
  // `?draft=true` request read a draft product regardless of collection
  // access — replaced by publicReadPublished, which constrains an
  // anonymous reader to `_status: 'published'` no matter what `draft` asks
  // for.
  it('7) an anonymous ?draft=true request never returns a draft product', async () => {
    const category = await createCategory()
    const draft = await payload.create({
      collection: 'products',
      data: {
        title: 'დრაფტი-პროდუქტი',
        category: category.id,
        tier: 'standard',
        description: EMPTY_RICH_TEXT,
        _status: 'draft',
      },
    })
    productIds.push(draft.id)

    const { docs } = await payload.find({
      collection: 'products',
      where: { id: { equals: draft.id } },
      draft: true,
      overrideAccess: false,
      user: null,
    })
    expect(docs).toHaveLength(0)
  })

  // Same leak, one level down: variants have no _status of their own, so
  // without publicReadVariantOfPublishedProduct an anonymous read of
  // /api/variants would still reveal the title/price/SKU of a draft
  // product's variant.
  it('8) a variant of a draft product is not visible to an anonymous read', async () => {
    const category = await createCategory()
    const draft = await payload.create({
      collection: 'products',
      data: {
        title: 'დრაფტი-ვარიანტიანი',
        category: category.id,
        tier: 'standard',
        description: EMPTY_RICH_TEXT,
        _status: 'draft',
      },
    })
    productIds.push(draft.id)

    const { docs: variants } = await payload.find({
      collection: 'variants',
      where: { product: { equals: draft.id } },
    })
    const variant = variants[0]!

    const { docs: anonymousVariants } = await payload.find({
      collection: 'variants',
      where: { id: { equals: variant.id } },
      overrideAccess: false,
      user: null,
    })
    expect(anonymousVariants).toHaveLength(0)
  })

  // Code review fix (T1.1–T1.8): recomputeProductPricing used
  // payload.update(), which reads the *latest* version (a pending draft, if
  // one exists) as its base and — since it saves without `draft: true` —
  // writes that base out as the published document. Approving a price on a
  // published product with an unsaved draft edit therefore silently
  // published (or merged in) the draft.
  it('9) approving a price on a published product with a pending draft edit does not touch the draft or publish it', async () => {
    const category = await createCategory()
    const product = await payload.create({
      collection: 'products',
      data: {
        title: 'გამოქვეყნებული-სახელი',
        category: category.id,
        tier: 'standard',
        description: EMPTY_RICH_TEXT,
        _status: 'published',
      },
    })
    productIds.push(product.id)

    // An unsaved draft edit sitting on top of the published doc.
    await payload.update({
      collection: 'products',
      id: product.id,
      data: { title: 'დრაფტი-სახელი' },
      draft: true,
    })

    const { docs: variants } = await payload.find({
      collection: 'variants',
      where: { product: { equals: product.id } },
    })
    const variant = variants[0]!

    // Simulates the approve endpoint (T1.4), which triggers
    // recomputeProductPricingAfterChange via variants' afterChange hook.
    await payload.update({
      collection: 'variants',
      id: variant.id,
      data: { price: 5000, priceStatus: 'approved' },
      overrideAccess: true,
    })

    const published = await payload.findByID({ collection: 'products', id: product.id, draft: false })
    expect(published.title).toBe('გამოქვეყნებული-სახელი')
    expect(published.minPrice).toBe(5000)
    expect(published.isPurchasable).toBe(true)

    const draftVersion = await payload.findByID({ collection: 'products', id: product.id, draft: true })
    expect(draftVersion.title).toBe('დრაფტი-სახელი')
  })

  it('10) publishing a pending draft edit after a price approval keeps the approved minPrice/isPurchasable', async () => {
    // Code review finding (Phase 2): recomputeProductPricing wrote the
    // approved price straight to the live `products` row via db.updateOne(),
    // but never to `_products_v`'s latest row. The admin edit form always
    // loads that latest version (`draft: true`) — stale minPrice/
    // isPurchasable included, since they're readOnly fields the form still
    // resubmits — so publishing *any* unrelated edit wrote the stale values
    // back out and the product vanished from the catalog.
    const category = await createCategory()
    const product = await payload.create({
      collection: 'products',
      data: {
        title: 'გამოსაქვეყნებელი',
        category: category.id,
        tier: 'standard',
        description: EMPTY_RICH_TEXT,
        _status: 'published',
      },
    })
    productIds.push(product.id)

    const { docs: variants } = await payload.find({
      collection: 'variants',
      where: { product: { equals: product.id } },
    })
    const variant = variants[0]!

    await payload.update({
      collection: 'variants',
      id: variant.id,
      data: { price: 6300, priceStatus: 'approved' },
      overrideAccess: true,
    })

    // An unrelated edit, saved as a draft first (as the admin UI does).
    await payload.update({
      collection: 'products',
      id: product.id,
      data: { title: 'გამოსაქვეყნებელი (რედაქტირებული)' },
      draft: true,
    })

    // Publishing resubmits the form's current field values — including the
    // readOnly minPrice/isPurchasable it loaded from that draft version.
    const draftForm = await payload.findByID({ collection: 'products', id: product.id, draft: true })
    await payload.update({
      collection: 'products',
      id: product.id,
      data: {
        title: draftForm.title,
        minPrice: draftForm.minPrice,
        isPurchasable: draftForm.isPurchasable,
        _status: 'published',
      },
    })

    const published = await payload.findByID({ collection: 'products', id: product.id })
    expect(published.title).toBe('გამოსაქვეყნებელი (რედაქტირებული)')
    expect(published.minPrice).toBe(6300)
    expect(published.isPurchasable).toBe(true)
  })
})
