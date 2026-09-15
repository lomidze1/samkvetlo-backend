// @vitest-environment node
import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload

const categoryIds: (number | string)[] = []
const productIds: (number | string)[] = []
const orderIds: (number | string)[] = []

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
          { type: 'text' as const, detail: 0, format: 0, mode: 'normal' as const, style: '', text: 'x', version: 1 as const },
        ],
      },
    ],
  },
}

function baseOrderData(submissionId: string, variantId: number) {
  return {
    submissionId,
    name: 'გიორგი',
    surname: 'ლომიძე',
    phone: '+995500000000',
    church: 'წმინდა გიორგის ეკლესია',
    items: [
      {
        variant: variantId,
        productTitle: 'საეკლესიო ზარი',
        variantTitle: 'სტანდარტული',
        sku: 'SMK-000001',
        unitPrice: 1000,
        qty: 1,
      },
    ],
    deliveryZone: { slug: 'tbilisi', name: 'თბილისი' },
    deliveryFeeGel: 0,
    status: 'new' as const,
  }
}

// Code review fix (T1.1–T1.8): generateVariantSku / generateOrderNumber used
// count()+1, which reuses a number once an earlier row is deleted (count
// drops back down) — replaced by the row's own primary key (assigned
// afterChange, once `doc.id` exists), which only ever moves forward.
describe('variant SKU / order number sequences (code review fix, T1.1–T1.8)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    for (const id of orderIds) await payload.delete({ collection: 'orders', id, overrideAccess: true }).catch(() => undefined)
    for (const id of productIds) {
      await payload.delete({ collection: 'variants', where: { product: { equals: id } } }).catch(() => undefined)
      await payload.delete({ collection: 'products', id }).catch(() => undefined)
    }
    for (const id of categoryIds) await payload.delete({ collection: 'categories', id }).catch(() => undefined)
  })

  it('creating 3 variants, deleting the 2nd, then creating a 4th never repeats a SKU', async () => {
    const category = await payload.create({
      collection: 'categories',
      data: { name: `SKU-სექვენსი ${Date.now()}-${Math.random()}` },
    })
    categoryIds.push(category.id)
    const product = await payload.create({
      collection: 'products',
      data: { title: `SKU სექვენსი ${Date.now()}-${Math.random()}`, category: category.id, tier: 'standard', description: EMPTY_RICH_TEXT },
    })
    productIds.push(product.id)

    // The product already got one default variant (createDefaultVariant).
    const v2 = await payload.create({
      collection: 'variants',
      data: { product: product.id, title: 'მეორე', coating: 'none', availability: 'ready' },
    })
    const v3 = await payload.create({
      collection: 'variants',
      data: { product: product.id, title: 'მესამე', coating: 'none', availability: 'ready' },
    })

    await payload.delete({ collection: 'variants', id: v2.id })

    const v4 = await payload.create({
      collection: 'variants',
      data: { product: product.id, title: 'მეოთხე', coating: 'none', availability: 'ready' },
    })

    const skus = [v2.sku, v3.sku, v4.sku]
    expect(new Set(skus).size).toBe(skus.length)
    expect(v4.sku).not.toBe(v2.sku)
  })

  it('creating 3 orders, deleting the 2nd, then creating a 4th never repeats an order number', async () => {
    const category = await payload.create({
      collection: 'categories',
      data: { name: `შეკვ-სექვენსი ${Date.now()}-${Math.random()}` },
    })
    categoryIds.push(category.id)
    const product = await payload.create({
      collection: 'products',
      data: { title: `შეკვ სექვენსი ${Date.now()}-${Math.random()}`, category: category.id, tier: 'standard', description: EMPTY_RICH_TEXT },
    })
    productIds.push(product.id)
    const { docs: variants } = await payload.find({ collection: 'variants', where: { product: { equals: product.id } } })
    const variantId = variants[0]!.id

    const order2 = await payload.create({
      collection: 'orders',
      data: baseOrderData(`sub-seq-2-${Date.now()}-${Math.random()}`, variantId),
      overrideAccess: true,
    })
    const order3 = await payload.create({
      collection: 'orders',
      data: baseOrderData(`sub-seq-3-${Date.now()}-${Math.random()}`, variantId),
      overrideAccess: true,
    })
    orderIds.push(order3.id)

    await payload.delete({ collection: 'orders', id: order2.id, overrideAccess: true })

    const order4 = await payload.create({
      collection: 'orders',
      data: baseOrderData(`sub-seq-4-${Date.now()}-${Math.random()}`, variantId),
      overrideAccess: true,
    })
    orderIds.push(order4.id)

    const numbers = [order2.number, order3.number, order4.number]
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(order4.number).not.toBe(order2.number)
  })
})
