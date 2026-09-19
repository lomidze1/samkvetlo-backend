import { getPayload, type Payload } from 'payload'
import config from '@/payload.config'

import { memoryEmailSender } from '@/server/notify/memoryAdapter'
import { recomputeCostingsForNewRate } from '@/server/rates/recompute'

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above the static imports above, so the factory can't
// close over a plain top-level const (temporal dead zone) — vi.hoisted
// gives it a binding that exists by the time the factory runs.
const { captureMessage } = vi.hoisted(() => ({ captureMessage: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureMessage }))

let payload: Payload
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

interface Fixture {
  categoryId: number
  costingId: number
  productId: number
  rateIds: number[]
  variantId: number
}

/**
 * recomputeCostingsForNewRate walks every costing in the DB, so each test
 * gets its own fully-isolated product/variant/costing/rate set and cleans
 * up (in `finally`) before the next test runs — otherwise a previous
 * test's leftover costing would be reprocessed (and re-emailed) too.
 */
async function createProductWithVariant(title: string): Promise<{ categoryId: number; productId: number; variantId: number }> {
  counter += 1
  const category = await payload.create({ collection: 'categories', data: { name: `${title} ${counter}` } })
  const product = await payload.create({
    collection: 'products',
    data: { title: `${title} ${counter}`, category: category.id, tier: 'standard', description: EMPTY_RICH_TEXT },
  })
  const { docs: variants } = await payload.find({ collection: 'variants', where: { product: { equals: product.id } } })
  return { categoryId: category.id, productId: product.id, variantId: variants[0]!.id }
}

async function createRate(rubGel: number, dayOffset: number): Promise<number> {
  const rate = await payload.create({
    collection: 'exchange-rates',
    data: { date: new Date(2026, 6, 1 + dayOffset).toISOString(), rubGel, usdGel: 2.6, source: 'test' },
  })
  return rate.id
}

async function cleanup(fixture: Fixture): Promise<void> {
  await payload.delete({ collection: 'costings', id: fixture.costingId }).catch(() => undefined)
  await payload.delete({ collection: 'variants', id: fixture.variantId }).catch(() => undefined)
  await payload.delete({ collection: 'products', id: fixture.productId }).catch(() => undefined)
  await payload.delete({ collection: 'categories', id: fixture.categoryId }).catch(() => undefined)
  for (const id of fixture.rateIds) {
    await payload.delete({ collection: 'exchange-rates', id }).catch(() => undefined)
  }
}

describe('recomputeCostingsForNewRate (T1.6, ADR 0006)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
    // recomputeCostingsForNewRate reads site-settings.ownerEmails to decide
    // where the digest goes — this file needs at least one, independent of
    // whatever another test file's suite left there.
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { ownerEmails: [{ email: 'owner-rates-test@samkvetlo.local' }] },
      overrideAccess: true,
    })
  })

  afterAll(async () => {
    await payload.updateGlobal({
      slug: 'site-settings',
      data: { ownerEmails: [] },
      overrideAccess: true,
    })
  })

  afterEach(() => {
    memoryEmailSender.reset()
    delete process.env.EMAIL_ADAPTER
    captureMessage.mockClear()
  })

  it('a rate change past needsReviewPct marks the variant needs-review, keeps the site price, and sends one digest email', async () => {
    process.env.EMAIL_ADAPTER = 'memory'
    const rate1 = await createRate(0.03, 1)
    const { categoryId, productId, variantId } = await createProductWithVariant('კურსის-პროდუქტი-A')

    const costing = await payload.create({
      collection: 'costings',
      data: { variant: variantId, costRub: 500_000, logisticsGel: 0, autoPricing: false },
      overrideAccess: true,
    })
    const priceBefore = costing.suggestedPriceGel
    await payload.update({
      collection: 'variants',
      id: variantId,
      data: { price: priceBefore, priceStatus: 'approved' },
      overrideAccess: true,
    })

    // A large rubGel jump -> suggested price moves far more than the
    // default 3% needsReviewPct threshold.
    const rate2 = await createRate(0.06, 2)
    const fixture: Fixture = { categoryId, productId, variantId, costingId: costing.id, rateIds: [rate1, rate2] }

    try {
      const result = await recomputeCostingsForNewRate(payload)
      expect(result.needsReview).toBe(1)
      expect(result.autoApplied).toBe(0)

      const updatedVariant = await payload.findByID({ collection: 'variants', id: variantId, depth: 0 })
      expect(updatedVariant.priceStatus).toBe('needs-review')
      expect(updatedVariant.price).toBe(priceBefore)

      expect(memoryEmailSender.sent).toHaveLength(1)
      expect(memoryEmailSender.sent[0]?.text).toContain(updatedVariant.sku)
    } finally {
      await cleanup(fixture)
    }
  })

  it('autoPricing + pConfirmed applies the new price automatically and logs an auto priceHistory entry', async () => {
    process.env.EMAIL_ADAPTER = 'memory'
    const rate1 = await createRate(0.03, 3)
    const { categoryId, productId, variantId } = await createProductWithVariant('კურსის-პროდუქტი-B')

    const costing = await payload.create({
      collection: 'costings',
      data: { variant: variantId, costRub: 500_000, logisticsGel: 0, autoPricing: true },
      overrideAccess: true,
    })
    const priceBefore = costing.suggestedPriceGel
    await payload.update({
      collection: 'variants',
      id: variantId,
      data: { price: priceBefore, priceStatus: 'approved' },
      overrideAccess: true,
    })

    const rate2 = await createRate(0.06, 4)
    const fixture: Fixture = { categoryId, productId, variantId, costingId: costing.id, rateIds: [rate1, rate2] }

    try {
      const result = await recomputeCostingsForNewRate(payload)
      expect(result.autoApplied).toBe(1)
      expect(result.needsReview).toBe(0)

      const updatedVariant = await payload.findByID({ collection: 'variants', id: variantId, depth: 0 })
      expect(updatedVariant.priceStatus).toBe('approved')
      expect(updatedVariant.price).not.toBe(priceBefore)

      const updatedCosting = await payload.findByID({ collection: 'costings', id: costing.id, depth: 0 })
      const lastEntry = updatedCosting.priceHistory?.at(-1)
      expect(lastEntry?.auto).toBe(true)
      expect(lastEntry?.to).toBe(updatedVariant.price)

      // Auto-applied, so no owner review is needed for this variant.
      expect(memoryEmailSender.sent).toHaveLength(0)
    } finally {
      await cleanup(fixture)
    }
  })

  it('a draft variant (never approved) is recomputed but never flagged needs-review', async () => {
    const rate1 = await createRate(0.03, 5)
    const { categoryId, productId, variantId } = await createProductWithVariant('draft-პროდუქტი')

    const costing = await payload.create({
      collection: 'costings',
      data: { variant: variantId, costRub: 500_000, logisticsGel: 0 },
      overrideAccess: true,
    })

    const rate2 = await createRate(0.06, 6)
    const fixture: Fixture = { categoryId, productId, variantId, costingId: costing.id, rateIds: [rate1, rate2] }

    try {
      const result = await recomputeCostingsForNewRate(payload)
      expect(result.needsReview).toBe(0)
      expect(result.autoApplied).toBe(0)

      const updatedVariant = await payload.findByID({ collection: 'variants', id: variantId, depth: 0 })
      expect(updatedVariant.priceStatus).toBe('draft')
    } finally {
      await cleanup(fixture)
    }
  })

  // T5.18 (ADR 0019 §7): a real adapter failure must not fail the caller —
  // prices are already written to needs-review by the time email is sent.
  it('an email sender failure does not throw; needsReview/priceStatus are unaffected and Sentry gets name/code only', async () => {
    process.env.EMAIL_ADAPTER = 'memory'
    const providerError = Object.assign(new Error('ProviderError: rate_limit_exceeded (someone@example.com)'), {
      name: 'ProviderError',
      code: 'rate_limit_exceeded',
    })
    const sendSpy = vi.spyOn(memoryEmailSender, 'send').mockRejectedValueOnce(providerError)

    const rate1 = await createRate(0.03, 7)
    const { categoryId, productId, variantId } = await createProductWithVariant('კურსის-პროდუქტი-C')

    const costing = await payload.create({
      collection: 'costings',
      data: { variant: variantId, costRub: 500_000, logisticsGel: 0, autoPricing: false },
      overrideAccess: true,
    })
    const priceBefore = costing.suggestedPriceGel
    await payload.update({
      collection: 'variants',
      id: variantId,
      data: { price: priceBefore, priceStatus: 'approved' },
      overrideAccess: true,
    })

    const rate2 = await createRate(0.06, 8)
    const fixture: Fixture = { categoryId, productId, variantId, costingId: costing.id, rateIds: [rate1, rate2] }

    try {
      const result = await recomputeCostingsForNewRate(payload)
      expect(result.needsReview).toBe(1)
      expect(result.autoApplied).toBe(0)

      const updatedVariant = await payload.findByID({ collection: 'variants', id: variantId, depth: 0 })
      expect(updatedVariant.priceStatus).toBe('needs-review')
      expect(updatedVariant.price).toBe(priceBefore)

      expect(captureMessage).toHaveBeenCalledTimes(1)
      const [message, args] = captureMessage.mock.calls[0]!
      expect(message).toBe('notification failed: email')
      expect(args).toEqual({ level: 'warning', extra: { channel: 'email', name: 'ProviderError', code: 'rate_limit_exceeded' } })
      expect(JSON.stringify(args)).not.toContain('someone@example.com')
    } finally {
      sendSpy.mockRestore()
      await cleanup(fixture)
    }
  })
})
