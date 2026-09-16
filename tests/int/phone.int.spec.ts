import { describe, expect, it } from 'vitest'

import { normalizeGeorgianPhone, PhoneSchema } from '@/shared/contract/phone'

// T3.2 (ADR 0003 §3): the plan's exact test vectors.
describe('normalizeGeorgianPhone (T3.2)', () => {
  it.each([
    ['599 12 34 56', '+995599123456'],
    ['+995 599 123 456', '+995599123456'],
    ['995599123456', '+995599123456'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeGeorgianPhone(input)).toBe(expected)
  })

  it('"12345" is rejected (too short to be a mobile number)', () => {
    expect(normalizeGeorgianPhone('12345')).toBeNull()
  })

  it('a 9-digit number not starting with 5 is rejected', () => {
    expect(normalizeGeorgianPhone('412345678')).toBeNull()
  })
})

describe('PhoneSchema', () => {
  it('normalizes a valid Georgian mobile number', () => {
    const result = PhoneSchema.safeParse('599 12 34 56')
    expect(result.success).toBe(true)
    expect(result.success && result.data).toBe('+995599123456')
  })

  it('an invalid number fails with message "invalid"', () => {
    const result = PhoneSchema.safeParse('12345')
    expect(result.success).toBe(false)
    expect(!result.success && result.error.issues[0]?.message).toBe('invalid')
  })

  it('an empty string fails with message "required"', () => {
    const result = PhoneSchema.safeParse('   ')
    expect(result.success).toBe(false)
    expect(!result.success && result.error.issues[0]?.message).toBe('required')
  })
})
