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
// Code review finding #3: matched against every Costings/Suppliers/Orders
// field that ADR 0005/D25 needs kept out of Sentry — supplier/cost/
// logistics numbers (Costings: supplier*, cost*, logistics*, markup*,
// notes), a supplier's public identity (Suppliers: website, contact — the
// same reason supplierName/supplierUrl matter: naming or reaching the
// supplier directly lets a competitor route around Samkvetlo), and
// customer PII (Orders: name/surname/phone/email/church/comment/city).
// No separate `sku` term: `supplierSku` is already caught by `supplier`,
// and the only other `sku` field in the schema (orders.items[].sku, our
// own product code) isn't a secret — every term here must independently
// matter (tests/unit/scrub-event.test.ts proves it).
const PII_KEY_PATTERN =
  /phone|email|name|surname|church|token|ownerSecret|supplier|cost|markup|logistics|notes|comment|city|website|contact/i

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
 * segment itself is redacted here — the query string is handled separately
 * by stripQuery below, for every URL, not just this one. */
function redactShareLinkPath(url: string): string {
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

/**
 * Code review finding m1: a query string can carry arbitrary user input —
 * an admin REST `where` filter can contain a phone number, a search box a
 * customer's name — that scrubEvent's key-based redaction never inspects
 * (there are no keys inside a raw query string). Dropped entirely rather
 * than redacted, for every URL, not just `/s/*`.
 */
function stripQuery(url: string): string {
  const queryIndex = url.indexOf('?')
  return queryIndex === -1 ? url : url.slice(0, queryIndex)
}

function scrubUrl(url: string | undefined): string | undefined {
  if (!url) return url
  return stripQuery(redactShareLinkPath(url))
}

function scrubRequest(request: Event['request']): Event['request'] {
  if (!request) return request
  const scrubbedHeaders = request.headers
    ? Object.fromEntries(
        Object.entries(request.headers).filter(([key]) => ALLOWED_HEADERS.includes(key.toLowerCase())),
      )
    : request.headers

  // `data` (the request body), `cookies`, and `query_string` are dropped
  // entirely — not just redacted — by simply not carrying them over into
  // the result. `query_string` specifically: `@sentry/core`'s own
  // request-data integration collects it independently of
  // `sendDefaultPii` (code review finding m1), so omitting it here is the
  // only way to guarantee it never reaches Sentry.
  return {
    method: request.method,
    env: request.env,
    headers: scrubbedHeaders,
    url: scrubUrl(request.url),
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
