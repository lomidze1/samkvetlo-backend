import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// ADR 0016 (D24, T5.14): admin is Georgia-only. This is layer 2
// (defence in depth) — layer 1 is a Vercel Firewall custom rule on the
// backend project (docs/runbooks/break-glass.md). Both layers are needed:
// the firewall rule can be turned off or reordered from the dashboard
// without a code review; this function is in git and covered by
// tests/unit/proxy.test.ts.
const BREAK_GLASS_MAX_MS = 72 * 60 * 60 * 1000

interface BreakGlass {
  expiresAt: Date
  ip: string
}

/**
 * Parses `ADMIN_BREAK_GLASS="<IP>;<expiresAt ISO-8601 UTC>"`. Any malformed
 * value (missing `;`, unparsable date) is treated as "no break-glass" —
 * fail closed, matching the rest of this function's default-deny stance.
 */
function parseBreakGlass(raw: string | undefined): BreakGlass | null {
  if (!raw) return null
  const separatorIndex = raw.indexOf(';')
  if (separatorIndex === -1) return null

  const ip = raw.slice(0, separatorIndex).trim()
  const expiresAtRaw = raw.slice(separatorIndex + 1).trim()
  if (!ip || !expiresAtRaw) return null

  const expiresAt = new Date(expiresAtRaw)
  if (Number.isNaN(expiresAt.getTime())) return null

  return { ip, expiresAt }
}

/**
 * ADR 0016: valid only when the request's IP exactly matches, the window
 * hasn't expired, and the window is at most 72h (a longer `expiresAt` is
 * ignored rather than honoured, capping any single break-glass grant).
 */
function isBreakGlassRequest(request: NextRequest): boolean {
  const breakGlass = parseBreakGlass(process.env.ADMIN_BREAK_GLASS)
  if (!breakGlass) return false

  // Vercel is trusted to have set this from the real connecting IP (ADR 0016).
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (!clientIp || clientIp !== breakGlass.ip) return false

  const now = Date.now()
  const expiresAtMs = breakGlass.expiresAt.getTime()
  if (now >= expiresAtMs) return false
  if (expiresAtMs - now > BREAK_GLASS_MAX_MS) return false

  return true
}

/**
 * Code review hardening: `/api/public/*` and `/api/cron/*` are exempt from
 * the geo check below, so the exemption itself must never say "yes" for a
 * path segment that could resolve to `..` somewhere downstream — even
 * though, empirically, `NextRequest`'s own URL parsing already collapses a
 * literal or percent-encoded `..` segment before `pathname` ever reaches
 * this function (verified against Next 16.3.3: `/api/public/%2e%2e/users`
 * arrives here as `/api/users`, already outside the exempt prefix). This
 * is belt-and-suspenders against that normalization ever changing or a
 * differently-parsed path reaching this check some other way: a segment
 * that decodes to `..` — literal, percent-encoded, or mixed-case — makes
 * the whole path ineligible for the exemption, falling through to the
 * geo check (fail-closed) instead of `NextResponse.next()`.
 */
export function containsDotSegment(pathname: string): boolean {
  return pathname.split('/').some((segment) => segment.replace(/%2e/gi, '.') === '..')
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl

  // /api/public/* (service-token auth) and /api/cron/* (CRON_SECRET) are
  // called from outside Georgia by design (frontend server in Germany,
  // Vercel Cron) — never geo-restricted.
  const isExemptPrefix = pathname.startsWith('/api/public/') || pathname.startsWith('/api/cron/')
  if (isExemptPrefix && !containsDotSegment(pathname)) {
    return NextResponse.next()
  }

  // Local dev, Docker, and tests have no `x-vercel-ip-country` header —
  // this only ever activates on Vercel.
  if (process.env.VERCEL !== '1') {
    return NextResponse.next()
  }

  if (request.headers.get('x-vercel-ip-country') === 'GE') {
    return NextResponse.next()
  }

  if (isBreakGlassRequest(request)) {
    console.warn('[break-glass]', { path: pathname })
    return NextResponse.next()
  }

  // Fail closed — including when the header is simply missing.
  return new NextResponse(null, { status: 403 })
}

export const config = {
  matcher: ['/admin/:path*', '/api/:path*'],
}
