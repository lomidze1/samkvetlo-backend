// T5.14 (ADR 0016): admin geo-restriction, layer 2. Pure unit test — no DB,
// no Next.js server — see vitest.unit.config.mts.
import { NextRequest } from 'next/server'
import { afterEach, describe, expect, it } from 'vitest'
import { proxy } from '../../src/proxy'

const ORIGINAL_ENV = { ...process.env }

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

function request(
  path: string,
  headers: Record<string, string> = {},
): NextRequest {
  return new NextRequest(`https://admin.samkvetlo.ge${path}`, { headers })
}

describe('proxy (ADR 0016 layer 2)', () => {
  it('passes everything when VERCEL is not set (local dev/Docker/tests)', () => {
    delete process.env.VERCEL
    expect(proxy(request('/admin')).status).toBe(200)
    expect(proxy(request('/api/orders')).status).toBe(200)
    expect(proxy(request('/api/users/login')).status).toBe(200)
  })

  describe('on Vercel', () => {
    it('passes GE', () => {
      process.env.VERCEL = '1'
      const response = proxy(request('/admin', { 'x-vercel-ip-country': 'GE' }))
      expect(response.status).toBe(200)
    })

    it.each(['/admin', '/admin/login', '/api/users/login', '/api/orders'])(
      'blocks a non-GE country on %s',
      (path) => {
        process.env.VERCEL = '1'
        const response = proxy(request(path, { 'x-vercel-ip-country': 'US' }))
        expect(response.status).toBe(403)
      },
    )

    it('blocks when the country header is missing (fail closed)', () => {
      process.env.VERCEL = '1'
      const response = proxy(request('/admin'))
      expect(response.status).toBe(403)
    })

    it.each(['/api/public/health', '/api/cron/retention'])(
      'never blocks %s, regardless of country',
      (path) => {
        process.env.VERCEL = '1'
        const response = proxy(request(path, { 'x-vercel-ip-country': 'US' }))
        expect(response.status).toBe(200)
      },
    )

    describe('break-glass', () => {
      const IP = '203.0.113.7'

      function withBreakGlass(hoursFromNow: number): string {
        const expiresAt = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString()
        return `${IP};${expiresAt}`
      }

      it('passes on an exact IP match within the window', () => {
        process.env.VERCEL = '1'
        process.env.ADMIN_BREAK_GLASS = withBreakGlass(1)
        const response = proxy(
          request('/admin', { 'x-vercel-ip-country': 'US', 'x-forwarded-for': IP }),
        )
        expect(response.status).toBe(200)
      })

      it('blocks a different IP', () => {
        process.env.VERCEL = '1'
        process.env.ADMIN_BREAK_GLASS = withBreakGlass(1)
        const response = proxy(
          request('/admin', { 'x-vercel-ip-country': 'US', 'x-forwarded-for': '198.51.100.1' }),
        )
        expect(response.status).toBe(403)
      })

      it('blocks an expired window', () => {
        process.env.VERCEL = '1'
        process.env.ADMIN_BREAK_GLASS = withBreakGlass(-1)
        const response = proxy(
          request('/admin', { 'x-vercel-ip-country': 'US', 'x-forwarded-for': IP }),
        )
        expect(response.status).toBe(403)
      })

      it('blocks a window longer than 72h', () => {
        process.env.VERCEL = '1'
        process.env.ADMIN_BREAK_GLASS = withBreakGlass(73)
        const response = proxy(
          request('/admin', { 'x-vercel-ip-country': 'US', 'x-forwarded-for': IP }),
        )
        expect(response.status).toBe(403)
      })

      it('blocks an invalid format', () => {
        process.env.VERCEL = '1'
        process.env.ADMIN_BREAK_GLASS = 'not-a-valid-value'
        const response = proxy(
          request('/admin', { 'x-vercel-ip-country': 'US', 'x-forwarded-for': IP }),
        )
        expect(response.status).toBe(403)
      })

      it('uses only the first x-forwarded-for IP', () => {
        process.env.VERCEL = '1'
        process.env.ADMIN_BREAK_GLASS = withBreakGlass(1)
        const response = proxy(
          request('/admin', {
            'x-vercel-ip-country': 'US',
            'x-forwarded-for': `${IP}, 10.0.0.1`,
          }),
        )
        expect(response.status).toBe(200)
      })
    })
  })
})
