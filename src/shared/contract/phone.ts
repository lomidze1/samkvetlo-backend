// SOURCE OF TRUTH — copied to samkvetlo by pnpm shared:sync (ADR 0012)
import { z } from 'zod'

/**
 * ADR 0003 §3: normalizes a Georgian mobile number to `+9955XXXXXXXX`.
 * Accepts a 9-digit national number ("599 12 34 56") or the same number
 * with a `995` country code, with or without `+` and separators
 * ("+995 599 123 456", "995599123456"). Anything else (wrong length, not a
 * mobile prefix) is rejected — the national number must start with `5`.
 */
export function normalizeGeorgianPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')

  let national: string
  if (digits.startsWith('995') && digits.length === 12) {
    national = digits.slice(3)
  } else if (digits.length === 9) {
    national = digits
  } else {
    return null
  }

  return /^5\d{8}$/.test(national) ? `+995${national}` : null
}

// Contract note (chief-architect, T3.2): every OrderInput field's zod issue
// message is one of exactly 'required' | 'tooLong' | 'invalid' — the field
// name itself comes from the issue's path, so publicEndpoint's `fields` map
// (e.g. `{ phone: 'invalid' }`) is enough for the frontend to pick a
// Georgian message from ka.ts without parsing a composite code.
export const PhoneSchema = z.string({ error: 'required' }).transform((value, ctx) => {
  if (value.trim().length === 0) {
    ctx.addIssue({ code: 'custom', message: 'required' })
    return z.NEVER
  }
  const normalized = normalizeGeorgianPhone(value)
  if (!normalized) {
    ctx.addIssue({ code: 'custom', message: 'invalid' })
    return z.NEVER
  }
  return normalized
})
