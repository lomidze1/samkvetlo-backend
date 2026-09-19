import { test, expect } from '@playwright/test'

const READ_TOKEN = process.env.SERVICE_TOKEN_READ ?? 'dev-read-token'

// T5.x SEO contract: the backend (admin, built-in REST, /api/public/*) must
// never be indexed — only next.config.ts's headers(), no backend robots.txt.
test.describe('X-Robots-Tag: noindex, nofollow (T5.x SEO contract)', () => {
  test('GET /admin/login sends X-Robots-Tag: noindex, nofollow', async ({ request }) => {
    const response = await request.get('/admin/login')
    expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow')
  })

  test('GET /api/public/health sends X-Robots-Tag: noindex, nofollow', async ({ request }) => {
    const response = await request.get('/api/public/health', {
      headers: { Authorization: `Bearer ${READ_TOKEN}` },
    })
    expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow')
  })
})

// T5.8 (ADR 0014 §3): security headers enforced, same real-HTTP check as
// the X-Robots-Tag suite above — on the two routes the DoD names.
test.describe('Security headers enforced (T5.8)', () => {
  test('GET /admin/login sends every T5.8 security header', async ({ request }) => {
    const response = await request.get('/admin/login')
    const headers = response.headers()
    expect(headers['strict-transport-security']).toContain('max-age=31536000')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['permissions-policy']).toContain('camera=()')
  })

  test('GET /api/public/health sends every T5.8 security header', async ({ request }) => {
    const response = await request.get('/api/public/health', {
      headers: { Authorization: `Bearer ${READ_TOKEN}` },
    })
    const headers = response.headers()
    expect(headers['strict-transport-security']).toContain('max-age=31536000')
    expect(headers['x-frame-options']).toBe('DENY')
    expect(headers['x-content-type-options']).toBe('nosniff')
    expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin')
    expect(headers['permissions-policy']).toContain('camera=()')
  })
})
