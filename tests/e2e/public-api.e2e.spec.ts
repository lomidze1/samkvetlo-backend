import { test, expect } from '@playwright/test'

const READ_TOKEN = process.env.SERVICE_TOKEN_READ ?? 'dev-read-token'

test.describe('/api/public/* (ADR 0012)', () => {
  test('GET /api/public/health with a read token returns ok + contract version header', async ({
    request,
  }) => {
    const response = await request.get('/api/public/health', {
      headers: { Authorization: `Bearer ${READ_TOKEN}` },
    })
    expect(response.status()).toBe(200)
    expect(response.headers()['x-contract-version']).toBeTruthy()

    const body = await response.json()
    expect(body).toEqual({ ok: true, contractVersion: expect.any(String) })
  })

  test('GET /api/public/health without a token returns 401', async ({ request }) => {
    const response = await request.get('/api/public/health')
    expect(response.status()).toBe(401)
  })

  test('GET /api/public/health with an invalid token returns 401', async ({ request }) => {
    const response = await request.get('/api/public/health', {
      headers: { Authorization: 'Bearer not-a-real-token' },
    })
    expect(response.status()).toBe(401)
  })

  // Code review (Phase 2): `coating` is a Postgres enum column — an
  // unlisted value used to reach the DB query unvalidated and 500.
  test('GET /api/public/products with an unlisted coating value is ignored, not a 500', async ({ request }) => {
    const response = await request.get('/api/public/products?coating=not-a-real-coating', {
      headers: { Authorization: `Bearer ${READ_TOKEN}` },
    })
    expect(response.status()).toBe(200)
  })
})
