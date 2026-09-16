// @vitest-environment node
import type { PayloadRequest } from 'payload'

import { afterEach, describe, expect, it } from 'vitest'

import { clientIpFromRequest, ipHashFromRequest } from '@/server/security/ipHash'

function fakeReq(headers: Record<string, string> = {}): PayloadRequest {
  return { headers: new Headers(headers) } as unknown as PayloadRequest
}

describe('ipHash (ADR 0012 §4 / ADR 0014 §2, review finding MINOR 5)', () => {
  const originalSalt = process.env.IP_HASH_SALT

  afterEach(() => {
    if (originalSalt === undefined) delete process.env.IP_HASH_SALT
    else process.env.IP_HASH_SALT = originalSalt
  })

  it('clientIpFromRequest reads x-client-ip, or "" when absent', () => {
    expect(clientIpFromRequest(fakeReq({ 'x-client-ip': '203.0.113.9' }))).toBe('203.0.113.9')
    expect(clientIpFromRequest(fakeReq())).toBe('')
  })

  it('fails closed (throws) when IP_HASH_SALT is missing — an unsalted hash is trivially reversible', () => {
    delete process.env.IP_HASH_SALT
    expect(() => ipHashFromRequest(fakeReq({ 'x-client-ip': '203.0.113.9' }))).toThrow()
  })

  it('fails closed (throws) when IP_HASH_SALT is the empty string', () => {
    process.env.IP_HASH_SALT = ''
    expect(() => ipHashFromRequest(fakeReq({ 'x-client-ip': '203.0.113.9' }))).toThrow()
  })

  it('returns a stable sha256 hex digest once a salt is configured', () => {
    process.env.IP_HASH_SALT = 'test-salt'
    const hash = ipHashFromRequest(fakeReq({ 'x-client-ip': '203.0.113.9' }))
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(ipHashFromRequest(fakeReq({ 'x-client-ip': '203.0.113.9' }))).toBe(hash)
  })
})
