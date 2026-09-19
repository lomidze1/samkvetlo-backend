// ADR 0018 §2/T5.17: pure unit tests for the TOTP wrapper — RFC 6238's own
// SHA-1 test vectors (Appendix B), plus the replay/window rules requireTotp
// relies on. No DB, no Next.js server — see vitest.unit.config.mts.
import { Secret } from 'otpauth'
import { describe, expect, it } from 'vitest'

import { verifyTotp } from '../../src/server/security/totp'

// RFC 6238 Appendix B uses the literal ASCII string "12345678901234567890"
// as the SHA-1 HMAC key (20 bytes) — encode it the same way our code
// expects the stored secret: base32.
const RFC_SECRET_BASE32 = Secret.fromLatin1('12345678901234567890').base32

// RFC 6238 publishes 8-digit codes; our TOTP is configured for 6 digits.
// ADR 0018: "6 digits = the last 6 digits of the RFC's 8-digit code" — the
// dynamic-truncation value is the same integer, just taken mod 10^6
// instead of mod 10^8, so the last 6 digits of the zero-padded 8-digit
// string are exactly our 6-digit code.
const RFC_VECTORS = [
  { timeSeconds: 59, code8: '94287082' },
  { timeSeconds: 1111111109, code8: '07081804' },
  { timeSeconds: 1234567890, code8: '89005924' },
  { timeSeconds: 2000000000, code8: '69279037' },
] as const

function code6(code8: string): string {
  return code8.slice(-6)
}

describe('verifyTotp (T5.17, ADR 0018 — RFC 6238 SHA-1 test vectors)', () => {
  it.each(RFC_VECTORS)('T = %s -> the last 6 digits of the RFC code validate', ({ timeSeconds, code8 }) => {
    const result = verifyTotp({
      secret: RFC_SECRET_BASE32,
      code: code6(code8),
      lastStep: null,
      now: new Date(timeSeconds * 1000),
    })
    expect(result.ok).toBe(true)
    expect(result.step).toBe(Math.floor(timeSeconds / 30))
  })

  it('accepts a code from one step earlier or later (±30 s)', () => {
    const base = 1111111109
    const code = code6('07081804')
    for (const offsetSeconds of [-30, 30]) {
      const result = verifyTotp({
        secret: RFC_SECRET_BASE32,
        code,
        lastStep: null,
        now: new Date((base + offsetSeconds) * 1000),
      })
      expect(result.ok).toBe(true)
    }
  })

  it('rejects a code from two steps away (±60 s)', () => {
    const base = 1111111109
    const code = code6('07081804')
    for (const offsetSeconds of [-60, 60]) {
      const result = verifyTotp({
        secret: RFC_SECRET_BASE32,
        code,
        lastStep: null,
        now: new Date((base + offsetSeconds) * 1000),
      })
      expect(result.ok).toBe(false)
    }
  })

  it('rejects replay: step <= lastStep', () => {
    const timeSeconds = 59
    const step = Math.floor(timeSeconds / 30)
    const code = code6('94287082')

    const accepted = verifyTotp({ secret: RFC_SECRET_BASE32, code, lastStep: step - 1, now: new Date(timeSeconds * 1000) })
    expect(accepted.ok).toBe(true)

    const replayed = verifyTotp({ secret: RFC_SECRET_BASE32, code, lastStep: step, now: new Date(timeSeconds * 1000) })
    expect(replayed.ok).toBe(false)
  })

  it('rejects a code that is not exactly 6 digits', () => {
    const now = new Date(59_000)
    for (const bad of ['', '12345', '1234567', 'abcdef', ' 12345', '123 45']) {
      expect(verifyTotp({ secret: RFC_SECRET_BASE32, code: bad, lastStep: null, now }).ok).toBe(false)
    }
  })
})
