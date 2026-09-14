import { describe, expect, it } from 'vitest'
import type { PayloadRequest } from 'payload'

import { checkServiceAuth } from '@/server/security/serviceAuth'

function requestWithAuth(authorization?: string): PayloadRequest {
  const headers = new Headers()
  if (authorization !== undefined) headers.set('authorization', authorization)
  return { headers } as unknown as PayloadRequest
}

const READ_TOKEN = process.env.SERVICE_TOKEN_READ ?? 'dev-read-token'
const WRITE_TOKEN = process.env.SERVICE_TOKEN_WRITE ?? 'dev-write-token'

describe('checkServiceAuth (ADR 0012 §4)', () => {
  it('accepts the read token for scope "read"', () => {
    expect(checkServiceAuth(requestWithAuth(`Bearer ${READ_TOKEN}`), 'read')).toBe('ok')
  })

  it('accepts the write token for scope "read" (write implies read)', () => {
    expect(checkServiceAuth(requestWithAuth(`Bearer ${WRITE_TOKEN}`), 'read')).toBe('ok')
  })

  it('accepts the write token for scope "write"', () => {
    expect(checkServiceAuth(requestWithAuth(`Bearer ${WRITE_TOKEN}`), 'write')).toBe('ok')
  })

  it('returns "unauthorized" when the Authorization header is missing', () => {
    expect(checkServiceAuth(requestWithAuth(), 'read')).toBe('unauthorized')
  })

  it('returns "unauthorized" for an empty bearer token', () => {
    expect(checkServiceAuth(requestWithAuth('Bearer '), 'read')).toBe('unauthorized')
  })

  it('returns "unauthorized" for an unknown token', () => {
    expect(checkServiceAuth(requestWithAuth('Bearer not-a-real-token'), 'read')).toBe(
      'unauthorized',
    )
  })

  it('returns "forbidden" when the read token is used for scope "write"', () => {
    expect(checkServiceAuth(requestWithAuth(`Bearer ${READ_TOKEN}`), 'write')).toBe('forbidden')
  })
})
