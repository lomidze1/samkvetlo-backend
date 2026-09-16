import { describe, expect, it } from 'vitest'

import { CartQuoteInputSchema } from '@/shared/contract/cart'
import { OrderInputSchema } from '@/shared/contract/order'

// T3.2 (ADR 0003 §3-4, ADR 0014 §5): zod contract for OrderInput. The
// HTTP-level `err.validation` / `err.deliveryZone.*` wrapping is covered by
// submitOrder.int.spec.ts through the actual /api/public/orders endpoint.
function validOrder(overrides: Record<string, unknown> = {}) {
  return {
    name: 'გიორგი',
    surname: 'ლომიძე',
    phone: '599 12 34 56',
    church: 'წმინდა გიორგის ეკლესია',
    deliveryZone: 'tbilisi',
    lines: [{ variantId: 1, qty: 1 }],
    submissionId: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
    turnstileToken: 'token',
    ...overrides,
  }
}

describe('OrderInputSchema (T3.2)', () => {
  it('accepts a minimal valid order and normalizes the phone', () => {
    const result = OrderInputSchema.safeParse(validOrder())
    expect(result.success).toBe(true)
    expect(result.success && result.data.phone).toBe('+995599123456')
  })

  it('missing deliveryZone fails with message "required" on the deliveryZone field', () => {
    const { deliveryZone: _omit, ...rest } = validOrder()
    const result = OrderInputSchema.safeParse(rest)
    expect(result.success).toBe(false)
    const issue = !result.success && result.error.issues.find((i) => i.path[0] === 'deliveryZone')
    expect(issue && issue.message).toBe('required')
  })

  it('an extra key (e.g. deliveryFeeGel) fails the strict schema', () => {
    const result = OrderInputSchema.safeParse(validOrder({ deliveryFeeGel: 200 }))
    expect(result.success).toBe(false)
  })

  it('name over 60 chars fails with message "tooLong"', () => {
    const result = OrderInputSchema.safeParse(validOrder({ name: 'ა'.repeat(61) }))
    expect(result.success).toBe(false)
    const issue = !result.success && result.error.issues.find((i) => i.path[0] === 'name')
    expect(issue && issue.message).toBe('tooLong')
  })

  it('church over 120 chars fails with message "tooLong"', () => {
    const result = OrderInputSchema.safeParse(validOrder({ church: 'ა'.repeat(121) }))
    expect(result.success).toBe(false)
    const issue = !result.success && result.error.issues.find((i) => i.path[0] === 'church')
    expect(issue && issue.message).toBe('tooLong')
  })

  it('an invalid email fails with message "invalid"', () => {
    const result = OrderInputSchema.safeParse(validOrder({ email: 'not-an-email' }))
    expect(result.success).toBe(false)
    const issue = !result.success && result.error.issues.find((i) => i.path[0] === 'email')
    expect(issue && issue.message).toBe('invalid')
  })

  it('city/comment are trimmed and NFC-normalized', () => {
    const result = OrderInputSchema.safeParse(validOrder({ city: '  თბილისი  ' }))
    expect(result.success).toBe(true)
    expect(result.success && result.data.city).toBe('თბილისი')
  })

  it('more than 30 lines fails', () => {
    const lines = Array.from({ length: 31 }, (_, index) => ({ variantId: index + 1, qty: 1 }))
    const result = OrderInputSchema.safeParse(validOrder({ lines }))
    expect(result.success).toBe(false)
  })

  it('qty 21 fails (max 20)', () => {
    const result = OrderInputSchema.safeParse(validOrder({ lines: [{ variantId: 1, qty: 21 }] }))
    expect(result.success).toBe(false)
  })
})

describe('CartQuoteInputSchema (T3.1)', () => {
  it('accepts 1..30 lines with an optional deliveryZone', () => {
    expect(CartQuoteInputSchema.safeParse({ lines: [{ variantId: 1, qty: 1 }] }).success).toBe(true)
    expect(
      CartQuoteInputSchema.safeParse({ lines: [{ variantId: 1, qty: 1 }], deliveryZone: 'tbilisi' }).success,
    ).toBe(true)
  })

  it('rejects an empty lines array', () => {
    expect(CartQuoteInputSchema.safeParse({ lines: [] }).success).toBe(false)
  })

  it('rejects an unknown top-level key', () => {
    expect(
      CartQuoteInputSchema.safeParse({ lines: [{ variantId: 1, qty: 1 }], totalGel: 100 }).success,
    ).toBe(false)
  })
})
