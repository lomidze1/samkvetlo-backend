import { getPayload, type Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'

import { approvePriceEndpoint } from '@/endpoints/approvePrice'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

let payload: Payload

const productIds: (number | string)[] = []
const categoryIds: (number | string)[] = []
const rateIds: (number | string)[] = []
const userIds: (number | string)[] = []
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

async function createVariantForCosting() {
  counter += 1
  const category = await payload.create({ collection: 'categories', data: { name: `ფასის-კატ ${counter}` } })
  categoryIds.push(category.id)
  const product = await payload.create({
    collection: 'products',
    data: { title: `ფასის პროდუქტი ${counter}`, category: category.id, tier: 'standard', description: EMPTY_RICH_TEXT },
  })
  productIds.push(product.id)
  const { docs: variants } = await payload.find({ collection: 'variants', where: { product: { equals: product.id } } })
  return variants[0]!
}

async function createRate() {
  counter += 1
  const rate = await payload.create({
    collection: 'exchange-rates',
    data: {
      date: new Date(2026, 0, counter).toISOString(),
      rubGel: 0.03,
      usdGel: 2.6,
      source: 'test',
    },
  })
  rateIds.push(rate.id)
  return rate
}

async function createAdmin() {
  counter += 1
  const admin = await payload.create({
    collection: 'users',
    data: { email: `pricing-admin-${counter}@samkvetlo.local`, password: 'test-password-16chars' },
  })
  userIds.push(admin.id)
  return admin
}

function fakeReq(overrides: Partial<PayloadRequest>): PayloadRequest {
  return { payload, ...overrides } as unknown as PayloadRequest
}

/**
 * approvePriceEndpoint.handler manages its own init/commit/killTransaction
 * internally (code review fix, T1.1–T1.8), so calling it directly is
 * already self-contained. (An earlier version of this helper wrapped it
 * with a *second*, outer init/commit/kill "to replicate Payload's
 * dispatcher" — Payload's real dispatcher for a custom root endpoint
 * (handleEndpoints/createPayloadRequest) does not actually do that, and the
 * extra layer made the inner initTransaction see an already-open
 * transaction and skip its own commit, deferring the real commit until
 * *after* the handler had already returned — silently defeating the
 * "revalidate only after commit" fix below.)
 */
async function callApprove(req: PayloadRequest): Promise<Response> {
  return approvePriceEndpoint.handler(req)
}

describe('costings + approve endpoint (T1.4, ADR 0006)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  afterEach(async () => {
    await payload.updateGlobal({ slug: 'pricing-settings', data: { pConfirmed: true } })
  })

  afterAll(async () => {
    for (const id of productIds) {
      const { docs: variants } = await payload.find({
        collection: 'variants',
        where: { product: { equals: id } },
        depth: 0,
      })
      for (const variant of variants) {
        await payload.delete({ collection: 'costings', where: { variant: { equals: variant.id } } })
      }
      await payload.delete({ collection: 'variants', where: { product: { equals: id } } })
      await payload.delete({ collection: 'products', id })
    }
    for (const id of categoryIds) await payload.delete({ collection: 'categories', id })
    for (const id of rateIds) await payload.delete({ collection: 'exchange-rates', id })
    for (const id of userIds) await payload.delete({ collection: 'users', id })
  })

  it('a fresh database has pricing-settings 30 / true / 10', async () => {
    const settings = await payload.findGlobal({ slug: 'pricing-settings' })
    expect(settings.pPercent).toBe(30)
    expect(settings.pConfirmed).toBe(true)
    expect(settings.roundingStepGel).toBe(10)
  })

  it('a new costing defaults autoPricing to false', async () => {
    await createRate()
    const variant = await createVariantForCosting()
    const costing = await payload.create({
      collection: 'costings',
      data: { variant: variant.id, costRub: 100_000, logisticsGel: 200 },
    })
    expect(costing.autoPricing).toBe(false)
  })

  it('saving autoPricing=true is rejected while pConfirmed=false', async () => {
    await createRate()
    const variant = await createVariantForCosting()
    await payload.updateGlobal({ slug: 'pricing-settings', data: { pConfirmed: false } })

    await expect(
      payload.create({
        collection: 'costings',
        data: { variant: variant.id, costRub: 100_000, logisticsGel: 200, autoPricing: true },
      }),
    ).rejects.toMatchObject({ status: 400 })
  })

  it('approve: writes variant.price/priceStatus and appends priceHistory', async () => {
    await createRate()
    const variant = await createVariantForCosting()
    // costGel ~15 900 ₾: comfortably between the USD markup floor and
    // ceiling, so markup = 30% of cost exactly -> share 30% -> green.
    const costing = await payload.create({
      collection: 'costings',
      data: { variant: variant.id, costRub: 500_000, logisticsGel: 0 },
    })
    expect(costing.indicator).toBe('green')

    const admin = await createAdmin()
    const response = await callApprove(
      fakeReq({
        user: admin,
        routeParams: { id: String(costing.id) },
        data: { price: costing.suggestedPriceGel },
      }),
    )
    expect(response.status).toBe(200)

    const updatedVariant = await payload.findByID({ collection: 'variants', id: variant.id, depth: 0 })
    expect(updatedVariant.price).toBe(costing.suggestedPriceGel)
    expect(updatedVariant.priceStatus).toBe('approved')

    const updatedCosting = await payload.findByID({ collection: 'costings', id: costing.id, depth: 0 })
    expect(updatedCosting.priceHistory).toHaveLength(1)
    expect(updatedCosting.priceHistory?.[0]?.to).toBe(costing.suggestedPriceGel)
    expect(updatedCosting.approvedBy).toBe(admin.id)
  })

  // Code review fix: the variant update revalidated through Variants' own
  // afterChange hook *before* the transaction committed. Silenced there now
  // (withRevalidateSkipped) and re-fired explicitly after commitTransaction.
  // Proven by reading the variant from a *fresh, non-transactional*
  // connection (no `req`) inside the mocked fetch call itself: if the
  // revalidate still fired pre-commit, that read would see the old,
  // uncommitted priceStatus (read-committed isolation).
  it('approve: notifyRevalidate fires exactly once, after the transaction commits', async () => {
    await createRate()
    const variant = await createVariantForCosting()
    const costing = await payload.create({
      collection: 'costings',
      data: { variant: variant.id, costRub: 500_000, logisticsGel: 0 },
    })
    const admin = await createAdmin()

    let priceStatusWhenRevalidateFired: string | null | undefined
    const fetchMock = vi.fn().mockImplementation(async () => {
      const freshRead = await payload.findByID({ collection: 'variants', id: variant.id, depth: 0, overrideAccess: true })
      priceStatusWhenRevalidateFired = freshRead.priceStatus
      return new Response(null, { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    try {
      const response = await callApprove(
        fakeReq({
          user: admin,
          routeParams: { id: String(costing.id) },
          data: { price: costing.suggestedPriceGel },
        }),
      )
      expect(response.status).toBe(200)
    } finally {
      vi.unstubAllGlobals()
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(init.body as string)).toEqual({ tags: ['catalog'] })
    expect(priceStatusWhenRevalidateFired).toBe('approved')
  })

  it('approve: a 🔴 costing without overrideRed is rejected with 400', async () => {
    await createRate()
    const variant = await createVariantForCosting()
    // High cost, markup capped at the USD ceiling -> tiny share -> actually
    // green; to force red we need cost so low the fixed floor dwarfs it.
    const costing = await payload.create({
      collection: 'costings',
      data: { variant: variant.id, costRub: 1_000, logisticsGel: 0 },
    })
    expect(costing.indicator).toBe('red')

    const admin = await createAdmin()
    await expect(
      callApprove(
        fakeReq({
          user: admin,
          routeParams: { id: String(costing.id) },
          data: { price: costing.suggestedPriceGel },
        }),
      ),
    ).rejects.toMatchObject({ status: 400 })
  })

  // Code review fix (T1.1–T1.8): the variant and costing updates ran as two
  // separate, un-transacted Local API calls — a costing-write failure after
  // the variant write succeeded left the variant price changed with no
  // matching costing record. approvePriceEndpoint now wraps both in one
  // transaction (initTransaction/commitTransaction/killTransaction).
  it('approve: a costing-write failure leaves the variant price unchanged', async () => {
    await createRate()
    const variant = await createVariantForCosting()
    const costing = await payload.create({
      collection: 'costings',
      data: { variant: variant.id, costRub: 500_000, logisticsGel: 0 },
    })
    const admin = await createAdmin()

    // Make the shared `payload.update` fail specifically for 'costings'
    // (the second write), so the variant write is guaranteed to have
    // already succeeded by the time the failure happens — then restore it,
    // pass or fail.
    const realUpdate = payload.update.bind(payload)
    payload.update = (async (args: Parameters<Payload['update']>[0]) => {
      if (args.collection === 'costings') {
        throw new Error('simulated costing write failure')
      }
      return realUpdate(args)
    }) as Payload['update']

    try {
      await expect(
        callApprove(
          fakeReq({
            user: admin,
            routeParams: { id: String(costing.id) },
            data: { price: costing.suggestedPriceGel },
          }),
        ),
      ).rejects.toThrow('simulated costing write failure')
    } finally {
      payload.update = realUpdate
    }

    const reloadedVariant = await payload.findByID({ collection: 'variants', id: variant.id, depth: 0 })
    expect(reloadedVariant.price).not.toBe(costing.suggestedPriceGel)
    expect(reloadedVariant.priceStatus).not.toBe('approved')

    const reloadedCosting = await payload.findByID({ collection: 'costings', id: costing.id, depth: 0 })
    expect(reloadedCosting.approvedBy).toBeFalsy()
  })

  it('approve: an anonymous call (no req.user) is forbidden', async () => {
    await createRate()
    const variant = await createVariantForCosting()
    const costing = await payload.create({
      collection: 'costings',
      data: { variant: variant.id, costRub: 50_000, logisticsGel: 100 },
    })

    const response = await callApprove(
      fakeReq({ user: null, routeParams: { id: String(costing.id) }, data: { price: costing.suggestedPriceGel } }),
    )
    expect(response.status).toBe(403)
  })
})
