import type { Payload } from 'payload'
import { Secret, TOTP } from 'otpauth'

// ADR 0018 (T5.17): test-only helpers for the in-house TOTP gate. Mirrors
// src/server/security/totp.ts's config (30 s step, 6 digits, SHA-1) but
// lives under tests/ since generating a *known* code for a *known* time is
// only ever needed by tests — production code only ever verifies.

const STEP_SECONDS = 30
const DIGITS = 6

export function newTotpSecret(): string {
  return new Secret({ size: 20 }).base32
}

export function currentTotpCode(secretBase32: string, now: Date = new Date()): string {
  const totp = new TOTP({
    issuer: 'Samkvetlo',
    algorithm: 'SHA1',
    digits: DIGITS,
    period: STEP_SECONDS,
    secret: Secret.fromBase32(secretBase32),
  })
  return totp.generate({ timestamp: now.getTime() })
}

/**
 * Enrolls (or rotates) `userId`'s TOTP secret via the Local API, the same
 * way scripts/admin-totp.ts and requireTotp.ts (success path) write it —
 * `totpSecret`/`totpLastStep` are access: () => false, so nothing else can.
 */
export async function enrollTotp(payload: Payload, userId: number | string, secret: string = newTotpSecret()): Promise<string> {
  await payload.update({
    collection: 'users',
    id: userId,
    data: { totpSecret: secret, totpLastStep: null, totpEnabledAt: new Date().toISOString() },
    overrideAccess: true,
  })
  return secret
}

/**
 * Clears the replay guard so a test can log the same user in more than
 * once within a single 30 s step without tripping requireTotp's replay
 * check — tests that specifically exercise replay do it themselves instead
 * of calling this.
 */
export async function resetTotpLastStep(payload: Payload, userId: number | string): Promise<void> {
  await payload.update({
    collection: 'users',
    id: userId,
    data: { totpLastStep: null },
    overrideAccess: true,
  })
}
