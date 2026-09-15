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
      data: { email: `test-admin-${Date.now()}@samkvetlo.local`, password: 'test-password' },
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
})
