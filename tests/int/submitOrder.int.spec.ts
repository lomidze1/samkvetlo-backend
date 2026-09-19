// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { getPayload, type Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'

import { submitOrder } from '@/server/orders/submitOrder'
import { ordersEndpoint } from '@/endpoints/public/orders'
import { approvePriceEndpoint } from '@/endpoints/approvePrice'

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

let payload: Payload

const productIds: (number | string)[] = []
const categoryIds: (number | string)[] = []
const userIds: (number | string)[] = []
const orderIds: (number | string)[] = []
const rateIds: (number | string)[] = []
const zoneIds: (number | string)[] = []
let counter = 0

// This file creates its own delivery zones rather than relying on seeded
// tbilisi/regional rows, so it stays correct regardless of what the seed
// contains (and doesn't collide with other suites/processes touching the
// same shared test database).
let zeroFeeZoneSlug: string
let paidZoneSlug: string

// Cloudflare's well-known Turnstile test secrets (ADR 0012 §4).
const PASS_SECRET = '1x0000000000000000000000000000000AA'
const FAIL_SECRET = '2x0000000000000000000000000000000AA'

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

async function createAdmin() {
  counter += 1
  const admin = await payload.create({
    collection: 'users',
    data: { email: `submit-order-admin-${counter}@samkvetlo.local`, password: 'test-password-16' },
  })
  userIds.push(admin.id)
  return admin
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

async function createZone(feeGel: number): Promise<string> {
  counter += 1
  const zone = await payload.create({
    collection: 'delivery-zones',
    data: { name: `submit-order-ზონა ${counter}`, feeGel, active: true },
    overrideAccess: true,
  })
  zoneIds.push(zone.id)
  return zone.slug!
}

async function createPurchasableVariant(): Promise<number> {
  await createRate()
  counter += 1
  const category = await payload.create({ collection: 'categories', data: { name: `submit-order-კატ ${counter}` } })
  categoryIds.push(category.id)
  const product = await payload.create({
    collection: 'products',
    data: {
      title: `submit-order-პროდუქტი ${counter}`,
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
    data: { variant: variant.id, costRub: 300_000, logisticsGel: 0 },
  })
  const admin = await createAdmin()
  const response = await approvePriceEndpoint.handler(
    fakeReq({ user: admin, routeParams: { id: String(costing.id) }, data: { price: costing.suggestedPriceGel } }),
  )
  expect(response.status).toBe(200)

  return variant.id
}

function baseInput(overrides: Partial<Parameters<typeof submitOrder>[1]> = {}) {
  return {
    name: 'გიორგი',
    surname: 'ლომიძე',
    phone: '+995599123456',
    church: 'წმინდა გიორგის ეკლესია',
    deliveryZone: zeroFeeZoneSlug,
    lines: [],
    submissionId: randomUUID(),
    turnstileToken: 'test-token',
    ...overrides,
  } as Parameters<typeof submitOrder>[1]
}

describe('submitOrder (T3.3, ADR 0003 §4 + updates, ADR 0015 §3-4)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    zeroFeeZoneSlug = await createZone(0)
    paidZoneSlug = await createZone(200)
  })

  beforeEach(() => {
    process.env.TURNSTILE_SECRET_KEY = PASS_SECRET
    fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { secret?: string }
      return new Response(JSON.stringify({ success: body.secret === PASS_SECRET }), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  afterAll(async () => {
    for (const id of orderIds) await payload.delete({ collection: 'orders', id, overrideAccess: true }).catch(() => undefined)
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
    for (const id of rateIds) await payload.delete({ collection: 'exchange-rates', id }).catch(() => undefined)
    for (const id of zoneIds) await payload.delete({ collection: 'delivery-zones', id, overrideAccess: true }).catch(() => undefined)
  })

  it('(1) creates an order with status=new and a frozen price snapshot', async () => {
    const variantId = await createPurchasableVariant()
    const variant = await payload.findByID({ collection: 'variants', id: variantId, depth: 0 })

    const result = await submitOrder(
      payload,
      baseInput({ lines: [{ variantId, qty: 2 }] }),
      { ipHash: `ip-${counter}-a`, clientIp: '1.2.3.4' },
    )
    expect(result.number).toMatch(/^SMK-\d{4}-\d{6}$/)
    expect(result.deliveryZone).toBe(zeroFeeZoneSlug)

    const { docs } = await payload.find({ collection: 'orders', where: { number: { equals: result.number } }, overrideAccess: true })
    const order = docs[0]!
    orderIds.push(order.id)
    expect(order.status).toBe('new')
    expect(order.items[0]).toMatchObject({ unitPrice: variant.price, qty: 2 })
  })

  it('(2) a repeated submissionId returns the same number, creates only one row, and does not call Turnstile again', async () => {
    const variantId = await createPurchasableVariant()
    const input = baseInput({ lines: [{ variantId, qty: 1 }] })
    const ctx = { ipHash: `ip-${counter}-b`, clientIp: '1.2.3.4' }

    // createPurchasableVariant's own product/variant/costing saves fire
    // their own (unrelated) revalidate fetch calls through the same
    // stubbed global fetch — only count calls to Turnstile's siteverify.
    const turnstileCallCount = () =>
      fetchMock.mock.calls.filter(([url]) => url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify')
        .length

    const first = await submitOrder(payload, input, ctx)
    orderIds.push((await payload.find({ collection: 'orders', where: { number: { equals: first.number } }, overrideAccess: true })).docs[0]!.id)
    expect(turnstileCallCount()).toBe(1)

    const second = await submitOrder(payload, input, ctx)
    expect(second.number).toBe(first.number)
    expect(turnstileCallCount()).toBe(1)

    const { totalDocs } = await payload.count({ collection: 'orders', where: { submissionId: { equals: input.submissionId } }, overrideAccess: true })
    expect(totalDocs).toBe(1)
  })

  it('(3) a 6th order within 10 minutes from the same ipHash is rate-limited (429 err.rateLimited)', async () => {
    const variantId = await createPurchasableVariant()
    const ipHash = `ip-${counter}-c`

    for (let i = 0; i < 5; i += 1) {
      const result = await submitOrder(payload, baseInput({ lines: [{ variantId, qty: 1 }] }), { ipHash, clientIp: '5.6.7.8' })
      orderIds.push((await payload.find({ collection: 'orders', where: { number: { equals: result.number } }, overrideAccess: true })).docs[0]!.id)
    }

    await expect(
      submitOrder(payload, baseInput({ lines: [{ variantId, qty: 1 }] }), { ipHash, clientIp: '5.6.7.8' }),
    ).rejects.toMatchObject({ status: 429, code: 'err.rateLimited' })
  })

  it('(4) a failing Turnstile secret prevents the order from being created (403 err.turnstile)', async () => {
    process.env.TURNSTILE_SECRET_KEY = FAIL_SECRET
    const variantId = await createPurchasableVariant()
    const input = baseInput({ lines: [{ variantId, qty: 1 }] })

    await expect(
      submitOrder(payload, input, { ipHash: `ip-${counter}-d`, clientIp: '9.9.9.9' }),
    ).rejects.toMatchObject({ status: 403, code: 'err.turnstile' })

    const { totalDocs } = await payload.count({ collection: 'orders', where: { submissionId: { equals: input.submissionId } }, overrideAccess: true })
    expect(totalDocs).toBe(0)
  })

  it('(5) a READ-scoped token on POST /api/public/orders is forbidden (403)', async () => {
    const response = await ordersEndpoint.handler(
      fakeReq({ headers: new Headers({ authorization: `Bearer ${process.env.SERVICE_TOKEN_READ}` }) }),
    )
    expect(response.status).toBe(403)
  })

  it('(5b) a missing x-client-ip is rejected (400 err.clientIp.missing) — MAJOR 1', async () => {
    const response = await ordersEndpoint.handler(
      fakeReq({ headers: new Headers({ authorization: `Bearer ${process.env.SERVICE_TOKEN_WRITE}` }) }),
    )
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe('err.clientIp.missing')
  })

  it('(6) a 200 ₾ zone freezes deliveryZone/deliveryFeeGel/totalGel on the order; a 0 ₾ zone freezes 0', async () => {
    const variantId = await createPurchasableVariant()
    const variant = await payload.findByID({ collection: 'variants', id: variantId, depth: 0 })

    const paid = await submitOrder(
      payload,
      baseInput({ deliveryZone: paidZoneSlug, lines: [{ variantId, qty: 1 }] }),
      { ipHash: `ip-${counter}-e`, clientIp: '1.1.1.1' },
    )
    const paidOrder = (await payload.find({ collection: 'orders', where: { number: { equals: paid.number } }, overrideAccess: true })).docs[0]!
    orderIds.push(paidOrder.id)
    expect(paidOrder.deliveryZone).toMatchObject({ slug: paidZoneSlug })
    expect(paidOrder.deliveryFeeGel).toBe(200)
    expect(paidOrder.totalGel).toBe((variant.price as number) + 200)

    const free = await submitOrder(
      payload,
      baseInput({ deliveryZone: zeroFeeZoneSlug, lines: [{ variantId, qty: 1 }] }),
      { ipHash: `ip-${counter}-f`, clientIp: '1.1.1.2' },
    )
    const freeOrder = (await payload.find({ collection: 'orders', where: { number: { equals: free.number } }, overrideAccess: true })).docs[0]!
    orderIds.push(freeOrder.id)
    expect(freeOrder.deliveryFeeGel).toBe(0)
  })

  it('(7) an unknown/inactive delivery zone is rejected and creates no order', async () => {
    const variantId = await createPurchasableVariant()
    const input = baseInput({ deliveryZone: 'no-such-zone', lines: [{ variantId, qty: 1 }] })

    await expect(
      submitOrder(payload, input, { ipHash: `ip-${counter}-g`, clientIp: '2.2.2.2' }),
    ).rejects.toMatchObject({ status: 400, code: 'err.deliveryZone.invalid' })

    const { totalDocs } = await payload.count({ collection: 'orders', where: { submissionId: { equals: input.submissionId } }, overrideAccess: true })
    expect(totalDocs).toBe(0)
  })

  it('a line that is no longer purchasable is rejected with 409 err.cart.changed, and creates no order', async () => {
    const input = baseInput({ lines: [{ variantId: 999_999_999, qty: 1 }] })
    await expect(
      submitOrder(payload, input, { ipHash: `ip-${counter}-h`, clientIp: '3.3.3.3' }),
    ).rejects.toMatchObject({ status: 409, code: 'err.cart.changed' })

    const { totalDocs } = await payload.count({ collection: 'orders', where: { submissionId: { equals: input.submissionId } }, overrideAccess: true })
    expect(totalDocs).toBe(0)
  })

  it("(8) changing a zone's feeGel after an order was placed does not change that order", async () => {
    const variantId = await createPurchasableVariant()
    const result = await submitOrder(
      payload,
      baseInput({ deliveryZone: paidZoneSlug, lines: [{ variantId, qty: 1 }] }),
      { ipHash: `ip-${counter}-i`, clientIp: '4.4.4.4' },
    )
    const order = (await payload.find({ collection: 'orders', where: { number: { equals: result.number } }, overrideAccess: true })).docs[0]!
    orderIds.push(order.id)
    expect(order.deliveryFeeGel).toBe(200)

    const { docs: zoneDocs } = await payload.find({ collection: 'delivery-zones', where: { slug: { equals: paidZoneSlug } }, overrideAccess: true })
    const zone = zoneDocs[0]!
    await payload.update({ collection: 'delivery-zones', id: zone.id, data: { feeGel: 350 }, overrideAccess: true })

    const reloaded = await payload.findByID({ collection: 'orders', id: order.id, overrideAccess: true })
    expect(reloaded.deliveryFeeGel).toBe(200)

    // restore, so a re-run of test (6)/(8) against the same zone id sees 200 again
    await payload.update({ collection: 'delivery-zones', id: zone.id, data: { feeGel: 200 }, overrideAccess: true })
  })

  it('(9) a throwing notification step (findGlobal) still returns the order number — MINOR 3', async () => {
    const variantId = await createPurchasableVariant()
    const findGlobalSpy = vi.spyOn(payload, 'findGlobal').mockRejectedValueOnce(new Error('site-settings unavailable'))

    let result: Awaited<ReturnType<typeof submitOrder>>
    try {
      result = await submitOrder(
        payload,
        baseInput({ lines: [{ variantId, qty: 1 }] }),
        { ipHash: `ip-${counter}-j`, clientIp: '6.6.6.6' },
      )
    } finally {
      findGlobalSpy.mockRestore()
    }

    expect(result.number).toMatch(/^SMK-\d{4}-\d{6}$/)
    const order = (await payload.find({ collection: 'orders', where: { number: { equals: result.number } }, overrideAccess: true })).docs[0]!
    orderIds.push(order.id)
    expect(order.notifications ?? []).toHaveLength(0)
  })
})
