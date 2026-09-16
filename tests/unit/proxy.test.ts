// T5.14 (ADR 0016): admin geo-restriction, layer 2. Pure unit test — no DB,
// no Next.js server — see vitest.unit.config.mts.
import { NextRequest } from 'next/server'
// Vendored inside `next` itself (next/dist/compiled/path-to-regexp) — no
// new dependency. This is the same `:path*` matcher compiler Next.js uses
// for `config.matcher`, so it's what the code-review finding means by
// "compile config.matcher": a test calling `proxy()` directly never
// exercises whether the *matcher* would even let a request reach it.
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match'
import { afterEach, describe, expect, it } from 'vitest'
import { config, containsDotSegment, proxy } from '../../src/proxy'

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

// Code review finding: `config.matcher` is what decides whether Next.js
// even calls `proxy()` for a given request — every test above calls
// `proxy()` directly, which would stay green even if the matcher changed
// to something that no longer covers bare `/admin` (e.g. `/admin/:path+`,
// which requires at least one segment). This compiles the actual matcher
// strings the same way Next.js does and checks the paths this ADR depends
// on are covered.
describe('config.matcher actually covers what proxy() assumes it does', () => {
  const matchers = config.matcher.map((pattern) => getPathMatch(pattern))

  function isMatched(pathname: string): boolean {
    return matchers.some((match) => match(pathname) !== false)
  }

  it.each(['/admin', '/admin/login', '/api/users/login', '/api/graphql', '/api/media/file/x.jpg'])(
    '%s is covered by config.matcher',
    (pathname) => {
      expect(isMatched(pathname)).toBe(true)
    },
  )

  it('/api/public/health is covered by config.matcher, and proxy() still passes it through', () => {
    expect(isMatched('/api/public/health')).toBe(true)

    process.env.VERCEL = '1'
    const response = proxy(request('/api/public/health', { 'x-vercel-ip-country': 'US' }))
    expect(response.status).toBe(200)
  })

  it('a plain storefront-shaped path is NOT covered (sanity: the matcher is not accidentally "everything")', () => {
    expect(isMatched('/')).toBe(false)
    expect(isMatched('/products')).toBe(false)
  })
})

// Code review hardening: an encoded traversal in the /api/public/* or
// /api/cron/* exemption must not slip past the geo check.
describe('containsDotSegment (encoded-traversal hardening)', () => {
  it.each([
    ['/api/public/../users', true],
    ['/api/public/%2e%2e/users', true],
    ['/api/public/%2E%2E/users', true],
    ['/api/public/%2E%2e/users', true],
    ['/api/public/.%2e/users', true],
    ['/api/public/%2e./users', true],
    ['/api/public/health', false],
    ['/api/public/health/..', true],
    ['/api/cron/retention', false],
  ])('containsDotSegment(%s) === %s', (pathname, expected) => {
    expect(containsDotSegment(pathname)).toBe(expected)
  })

  it('end-to-end: an encoded-traversal /api/public/ URL still ends up blocked, not exempted', () => {
    process.env.VERCEL = '1'
    // NextRequest's own URL parsing already collapses this to `/api/users`
    // (verified against Next 16.3.3) — so this proves the request is
    // blocked end-to-end (it lands outside the exempt prefix entirely),
    // independent of and in addition to containsDotSegment's own
    // belt-and-suspenders check above.
    const req = request('/api/public/%2e%2e/users', { 'x-vercel-ip-country': 'US' })
    expect(req.nextUrl.pathname.startsWith('/api/public/')).toBe(false)
    expect(proxy(req).status).toBe(403)
  })
})
