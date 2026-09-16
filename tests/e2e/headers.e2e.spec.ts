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
