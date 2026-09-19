import { Secret, TOTP } from 'otpauth'

// ADR 0018: in-house TOTP (RFC 6238), 30 s step, 6 digits, SHA-1. Pure
// wrapper around `otpauth` — no Payload/DB imports, so it can be unit
// tested directly against the RFC's own test vectors.

const STEP_SECONDS = 30
const DIGITS = 6
const ISSUER = 'Samkvetlo'

function makeTotp(secretBase32: string): TOTP {
  return new TOTP({
    issuer: ISSUER,
    algorithm: 'SHA1',
    digits: DIGITS,
    period: STEP_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  })
}

/** New random 160-bit secret (base32) for a fresh enrollment/rotation. */
export function generateTotpSecret(): string {
  return new Secret({ size: 20 }).base32
}

/** `otpauth://` URI for an authenticator app (Google Authenticator, 1Password, ...). */
export function buildOtpauthUri(secretBase32: string, email: string): string {
  const totp = makeTotp(secretBase32)
  totp.label = email
  return totp.toString()
}

export interface VerifyTotpArgs {
  secret: string
  code: string
  /** Last accepted step (replay guard) — null/undefined if never enrolled/used. */
  lastStep: number | null | undefined
  /** Defaults to `new Date()` — a parameter only so tests can pin the clock. */
  now?: Date
}

export interface VerifyTotpResult {
  ok: boolean
  /** The matched step, only present when `ok` is true — caller persists it as the new `totpLastStep`. */
  step?: number
}

/**
 * Validates a 6-digit TOTP code against `secret`, ±1 step (±30 s), and
 * rejects replay (`step <= lastStep`). ADR 0018 §2: any structural
 * rejection (bad code shape, no match, replay) is just `{ ok: false }` —
 * the caller (requireTotp) turns every case into the same one Georgian
 * error message.
 */
export function verifyTotp({ secret, code, lastStep, now }: VerifyTotpArgs): VerifyTotpResult {
  if (!/^\d{6}$/.test(code)) return { ok: false }

  const timestamp = (now ?? new Date()).getTime()
  const totp = makeTotp(secret)
  const delta = totp.validate({ token: code, timestamp, window: 1 })
  if (delta === null) return { ok: false }

  const step = totp.counter({ timestamp }) + delta
  if (typeof lastStep === 'number' && step <= lastStep) return { ok: false }

  return { ok: true, step }
}
