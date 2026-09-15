// @vitest-environment node
import { getPayload, type Payload, type PayloadRequest } from 'payload'
import config from '@/payload.config'

import { describe, expect, it, beforeAll } from 'vitest'

let payload: Payload

function anonymousRequest(): PayloadRequest {
  return { payload, headers: new Headers(), routeParams: {} } as unknown as PayloadRequest
}

describe('every /api/public/* route requires a service token (ADR 0005/0012 §4)', () => {
  beforeAll(async () => {
    payload = await getPayload({ config: await config })
  })

  it('every endpoint under /public/ returns 401 without an Authorization header', async () => {
    const resolvedConfig = await config
    const publicEndpoints = resolvedConfig.endpoints?.filter(
      (endpoint) => 'path' in endpoint && endpoint.path.startsWith('/public/'),
    )
    expect(publicEndpoints?.length ?? 0).toBeGreaterThan(0)

    for (const endpoint of publicEndpoints ?? []) {
      if (!('handler' in endpoint) || typeof endpoint.handler !== 'function') continue
      const response = await endpoint.handler(anonymousRequest())
      expect(response.status, `${endpoint.method?.toUpperCase()} ${endpoint.path}`).toBe(401)
    }
  })
})
