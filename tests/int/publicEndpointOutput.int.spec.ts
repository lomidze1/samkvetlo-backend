import type { PayloadRequest } from 'payload'
import { z } from 'zod'

import { publicEndpoint } from '@/endpoints/public/publicEndpoint'

import { describe, expect, it } from 'vitest'

const READ_TOKEN = process.env.SERVICE_TOKEN_READ ?? 'dev-read-token'

function requestWithToken(token: string): PayloadRequest {
  const headers = new Headers({ authorization: `Bearer ${token}` })
  return { headers, payload: { logger: { error: () => undefined } } } as unknown as PayloadRequest
}

describe('publicEndpoint output validation (ADR 0005/0012 §3)', () => {
  it('an unknown key in the handler result fails closed: 500, body not sent', async () => {
    const endpoint = publicEndpoint({
      path: '/public/_test-leak',
      method: 'get',
      scope: 'read',
      output: z.strictObject({ ok: z.boolean() }),
      // Simulates a mapper that accidentally spread a secret field through.
      handler: async () => ({ ok: true, supplierName: 'ZZSENT-NAME-7f3a' }) as unknown as { ok: boolean },
    })

    const response = await endpoint.handler(requestWithToken(READ_TOKEN))
    expect(response.status).toBe(500)
    const body = await response.text()
    expect(body).not.toContain('ZZSENT')
    expect(JSON.parse(body)).toEqual({ error: { code: 'err.internal' } })
  })

  it('a valid response carries x-contract-version', async () => {
    const endpoint = publicEndpoint({
      path: '/public/_test-ok',
      method: 'get',
      scope: 'read',
      output: z.strictObject({ ok: z.boolean() }),
      handler: async () => ({ ok: true }),
    })

    const response = await endpoint.handler(requestWithToken(READ_TOKEN))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-contract-version')).toBeTruthy()
  })
})
