import type { Breadcrumb, Event } from '@sentry/nextjs'

// ADR 0014 §11: never send the request body/cookies, or a value keyed by
// anything that looks like a customer's contact details (D25/ADR 0005 —
// the same fields the retention cron anonymizes) or supplier/costing data
// (ADR 0005's cardinal rule), wherever they show up in an event.
//
// Headers are an ALLOWLIST, not a denylist (code review finding): a
// denylist only blocks headers it was written to know about, so the very
// first request carrying a header nobody thought to list — Vercel's own
// `x-forwarded-for`/`x-real-ip`/`x-vercel-forwarded-for`/
// `x-vercel-ip-country`/`x-vercel-ip-city` among them — ships straight
// through, including on an admin request, i.e. exactly the IP/geo data
// ADR 0016 says must never be stored. An allowlist can only ever be too
// strict, never too permissive.
const ALLOWED_HEADERS = ['user-agent', 'content-type', 'x-contract-version']
const PII_KEY_PATTERN = /phone|email|name|surname|church|token|ownerSecret|supplier|costing|costRub|markup|sku/i

function redactPII(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (Array.isArray(value)) return value.map((item) => redactPII(item, seen))
  if (value !== null && typeof value === 'object') {
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    const result: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) {
      result[key] = PII_KEY_PATTERN.test(key) ? '[Filtered]' : redactPII(entry, seen)
    }
    return result
  }
  return value
}

/** ADR 0014 §13: a share-link token must never reach a log or a third-party
 * service. It lives in the path (`/s/{token}`), not the query, so the token
 * segment itself is redacted — dropping only the query string would still
 * ship the token to Sentry. */
function redactShareLinkUrl(url: string | undefined): string | undefined {
  if (!url) return url
  try {
    const parsed = new URL(url, 'http://placeholder.invalid')
    const match = /^\/s\/([^/]+)(\/.*)?$/.exec(parsed.pathname)
    if (!match) return url
    const origin = url.startsWith('http') ? parsed.origin : ''
    return `${origin}/s/[token]${match[2] ?? ''}`
  } catch {
    return url
  }
}

function scrubRequest(request: Event['request']): Event['request'] {
  if (!request) return request
  const scrubbedHeaders = request.headers
    ? Object.fromEntries(
        Object.entries(request.headers).filter(([key]) => ALLOWED_HEADERS.includes(key.toLowerCase())),
      )
    : request.headers

  // `data` (the request body) and `cookies` are dropped entirely — not
  // just redacted — by simply not carrying them over into the result.
  return {
    method: request.method,
    query_string: request.query_string,
    env: request.env,
    headers: scrubbedHeaders,
    url: redactShareLinkUrl(request.url),
  }
}

/**
 * `beforeSend` / `beforeSendTransaction` for both Sentry projects (T5.10).
 * Pure — takes an event, returns the scrubbed event; never mutates the
 * input or talks to the network.
 */
export function scrubEvent<E extends Event>(event: E): E {
  return {
    ...event,
    request: scrubRequest(event.request),
    extra: event.extra ? (redactPII(event.extra) as Event['extra']) : event.extra,
    contexts: event.contexts ? (redactPII(event.contexts) as Event['contexts']) : event.contexts,
  }
}

/** `beforeBreadcrumb` — a breadcrumb (e.g. a logged fetch call) can carry
 * the same kind of data as an event's `extra`. */
export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return breadcrumb.data ? { ...breadcrumb, data: redactPII(breadcrumb.data) as Breadcrumb['data'] } : breadcrumb
}
