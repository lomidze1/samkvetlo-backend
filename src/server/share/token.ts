import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

// ADR 0011 §1 / ADR 0014 §13: 256-bit random token, base64url-encoded (43
// chars, no padding). Only its sha256 hash is ever written to the DB — same
// rule for ownerSecret.
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

export function generateOwnerSecret(): string {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function hashOwnerSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

/** Constant-time hex-digest comparison — same approach as serviceAuth.ts's constantTimeEqual. */
export function constantTimeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex')
  const bufB = Buffer.from(b, 'hex')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}
