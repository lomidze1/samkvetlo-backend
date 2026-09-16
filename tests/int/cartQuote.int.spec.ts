// @vitest-environment node
import { getPayload, type Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'

import { quoteCart } from '@/server/orders/quoteCart'
import { PublicHttpError } from '@/endpoints/public/publicEndpoint'
import { approvePriceEndpoint } from '@/endpoints/approvePrice'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let payload: Payload

const productIds: (number | string)[] = []
const categoryIds: (number | string)[] = []
const userIds: (number | string)[] = []
const zoneIds: (number | string)[] = []
const rateIds: (number | string)[] = []
let counter = 0

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

function fakeReq(overrides: Partial<PayloadRequest>): PayloadRequest {
  return { payload, ...overrides } as unknown as PayloadRequest
}

async function createRate() {
  counter += 1
  const rate = await payload.create({
    collection: 'exchange-rates',
    data: { date: new Date(2026, 0, counter).toISOString(), rubGel: 0.03, usdGel: 2.6, source: 'test' },
  })
  rateIds.push(rate.id)
  return rate
}

async function createAdmin() {
  counter += 1
  const admin = await payload.create({
    collection: 'users',
    data: { email: `cart-quote-admin-${counter}@samkvetlo.local`, password: 'test-password' },
  })
  userIds.push(admin.id)
  return admin
}

/** A published product with one variant carrying an *approved* (purchasable) price. */
async function createPurchasableVariant(): Promise<{ variantId: number; price: number; productSlug: string; productTitle: string }> {
  await createRate()
  counter += 1
  const category = await payload.create({ collection: 'categories', data: { name: `კალათა-კატ ${counter}` } })
  categoryIds.push(category.id)
  const product = await payload.create({
    collection: 'products',
    data: {
      title: `კალათა-პროდუქტი ${counter}`,
      category: category.id,
      tier: 'standard',
      description: EMPTY_RICH_TEXT,
      _status: 'published',
    },
  })
  productIds.push(product.id)

  const { docs: variants } = await payload.find({ collection: 'variants', where: { product: { equals: product.id } } })
  const variant = variants[0]!

  const costing = await payload.create({
    collection: 'costings',
    data: { variant: variant.id, costRub: 500_000, logisticsGel: 0 },
  })
  const admin = await createAdmin()
  const response = await approvePriceEndpoint.handler(
    fakeReq({ user: admin, routeParams: { id: String(costing.id) }, data: { price: costing.suggestedPriceGel } }),
  )
  expect(response.status).toBe(200)

  return {
    variantId: variant.id,
    price: costing.suggestedPriceGel!,
    productSlug: product.slug!,
    productTitle: product.title,
  }
}

// Tests create their own zones rather than relying on the seeded
// tbilisi/regional rows — this file's assertions only need "a 0 ₾ zone"
// and "a 200 ₾ zone" to exist, and stay correct however the seed evolves.
async function createZone(feeGel: number, active = true): Promise<string> {
  counter += 1
  const zone = await payload.create({
    collection: 'delivery-zones',
    data: { name: `კალათა-ზონა ${counter}`, feeGel, active },
    overrideAccess: true,
  })
  zoneIds.push(zone.id)
  return zone.slug!
}

describe('quoteCart (T3.1, ADR 0003/0015)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterAll(async () => {
    for (const id of productIds) {
      const { docs: variants } = await payload.find({ collection: 'variants', where: { product: { equals: id } }, depth: 0 })
      for (const variant of variants) {
        await payload.delete({ collection: 'costings', where: { variant: { equals: variant.id } } }).catch(() => undefined)
      }
      await payload.delete({ collection: 'variants', where: { product: { equals: id } } }).catch(() => undefined)
      await payload.delete({ collection: 'products', id }).catch(() => undefined)
    }
    for (const id of categoryIds) await payload.delete({ collection: 'categories', id }).catch(() => undefined)
    for (const id of userIds) await payload.delete({ collection: 'users', id }).catch(() => undefined)
    for (const id of zoneIds) await payload.delete({ collection: 'delivery-zones', id, overrideAccess: true }).catch(() => undefined)
    for (const id of rateIds) await payload.delete({ collection: 'exchange-rates', id }).catch(() => undefined)
  })

  it('without a deliveryZone, deliveryFeeGel is null and totalGel = itemsTotalGel', async () => {
    const { variantId, price } = await createPurchasableVariant()
    const quote = await quoteCart(payload, { lines: [{ variantId, qty: 2 }] })

    expect(quote.deliveryFeeGel).toBeNull()
    expect(quote.itemsTotalGel).toBe(price * 2)
    expect(quote.totalGel).toBe(price * 2)
    expect(quote.lines[0]).toMatchObject({ available: true, unitPrice: price, lineTotal: price * 2, qty: 2 })
  })

  it('a 0 ₾ zone (e.g. "tbilisi") -> deliveryFeeGel = 0', async () => {
    const { variantId, price } = await createPurchasableVariant()
    const zeroFeeSlug = await createZone(0)
    const quote = await quoteCart(payload, { lines: [{ variantId, qty: 1 }], deliveryZone: zeroFeeSlug })

    expect(quote.deliveryFeeGel).toBe(0)
    expect(quote.totalGel).toBe(price)
  })

  it('a 200 ₾ zone adds the fee once per order, regardless of line count', async () => {
    const a = await createPurchasableVariant()
    const b = await createPurchasableVariant()
    const paidZoneSlug = await createZone(200)
    const quote = await quoteCart(payload, {
      lines: [
        { variantId: a.variantId, qty: 1 },
        { variantId: b.variantId, qty: 1 },
      ],
      deliveryZone: paidZoneSlug,
    })

    expect(quote.deliveryFeeGel).toBe(200)
    expect(quote.itemsTotalGel).toBe(a.price + b.price)
    expect(quote.totalGel).toBe(a.price + b.price + 200)
  })

  it('an unknown delivery zone slug throws PublicHttpError(400, err.deliveryZone.invalid)', async () => {
    const { variantId } = await createPurchasableVariant()
    await expect(
      quoteCart(payload, { lines: [{ variantId, qty: 1 }], deliveryZone: 'no-such-zone' }),
    ).rejects.toMatchObject({ status: 400, code: 'err.deliveryZone.invalid' })
  })

  it('an inactive delivery zone slug is treated as invalid', async () => {
    const { variantId } = await createPurchasableVariant()
    const inactiveSlug = await createZone(50, false)
    await expect(
      quoteCart(payload, { lines: [{ variantId, qty: 1 }], deliveryZone: inactiveSlug }),
    ).rejects.toBeInstanceOf(PublicHttpError)
  })

  it('an unknown variantId comes back as an unavailable line with no product data, excluded from itemsTotalGel', async () => {
    const quote = await quoteCart(payload, { lines: [{ variantId: 999_999_999, qty: 1 }] })
    expect(quote.lines[0]).toMatchObject({ available: false, productSlug: null, unitPrice: null, lineTotal: null })
    expect(quote.itemsTotalGel).toBe(0)
  })

  it('a line with a configurationId is unavailable but still carries product data (Phase 4 not built yet)', async () => {
    const { variantId, productSlug } = await createPurchasableVariant()
    const quote = await quoteCart(payload, { lines: [{ variantId, qty: 1, configurationId: 'draft-1' }] })
    expect(quote.lines[0]).toMatchObject({ available: false, productSlug, unitPrice: null })
    expect(quote.itemsTotalGel).toBe(0)
  })
})
