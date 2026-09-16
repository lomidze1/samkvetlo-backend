import { createHash } from 'node:crypto'
import type { PayloadRequest } from 'payload'

/**
 * ADR 0012 §4: the frontend forwards the real client IP as `x-client-ip`.
 * It is only trusted once a valid service token has been checked
 * (publicEndpoint runs that check before any handler using this can run).
 */
export function clientIpFromRequest(req: PayloadRequest): string {
  return req.headers.get('x-client-ip') ?? ''
}

/**
 * ADR 0012 §4 / ADR 0014 §2: ipHash = sha256(ip + IP_HASH_SALT), hex-encoded.
 * Fails closed on a missing salt — hashing without it would be trivially
 * reversible for an IPv4 address (review finding MINOR 5), which defeats
 * the point of storing only a hash.
 */
export function ipHashFromRequest(req: PayloadRequest): string {
  const salt = process.env.IP_HASH_SALT
  if (!salt) throw new Error('IP_HASH_SALT is not configured')
  return createHash('sha256').update(clientIpFromRequest(req) + salt).digest('hex')
}
