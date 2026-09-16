import { describe, expect, it } from 'vitest'
import type { Breadcrumb, Event } from '@sentry/nextjs'

import { scrubBreadcrumb, scrubEvent } from '@/lib/security/scrubEvent'
import { SENTINEL } from '../fixtures/sentinel'

// A realistic event: an order-update request (from the admin UI) that
// failed, the kind of thing that would otherwise carry the most PII of
// anything on this backend.
function realisticEvent(): Event {
  return {
    event_id: 'abc123',
    level: 'error',
    exception: { values: [{ type: 'PayloadValidationError', value: 'orders.update failed' }] },
    request: {
      url: 'https://admin.samkvetlo.ge/api/orders/42',
      method: 'PATCH',
      data: { name: 'გიორგი', phone: '+995555123456', items: [{ variantId: 1, qty: 2 }] },
      cookies: { 'payload-token': 'abc' },
      headers: {
        authorization: 'Bearer dev-write-token',
        cookie: 'payload-token=abc',
        'x-client-ip': '1.2.3.4',
        // ADR 0016 (code review finding): Vercel's own IP/geo headers —
        // must never reach Sentry, same as x-client-ip above.
        'x-forwarded-for': '5.6.7.8',
        'x-real-ip': '5.6.7.8',
        'x-vercel-forwarded-for': '5.6.7.8',
        'x-vercel-ip-country': 'GE',
        'x-vercel-ip-city': 'Tbilisi',
        'user-agent': 'Mozilla/5.0',
        'content-type': 'application/json',
        'x-contract-version': '2026-09-16.1',
        // Never listed anywhere — proves the allowlist blocks a header it
        // has never heard of, not just the ones a denylist would enumerate.
        'x-some-header-nobody-thought-of': 'surprise',
      },
    },
    extra: {
      submission: { name: 'გიორგი', surname: 'ლომიძე', email: 'g@example.com', church: 'წმინდა გიორგის ტაძარი' },
      itemsTotalGel: 27730,
    },
    contexts: {
      customer: { phone: '+995555123456', ownerSecret: 'super-secret' },
    },
  }
}

describe('scrubEvent (T5.10, ADR 0014 §11)', () => {
  it('strips the request body and cookies entirely', () => {
    const scrubbed = scrubEvent(realisticEvent())
    expect(scrubbed.request?.data).toBeUndefined()
    expect(scrubbed.request?.cookies).toBeUndefined()
  })

  it('headers are an allowlist: only user-agent/content-type/x-contract-version survive', () => {
    const scrubbed = scrubEvent(realisticEvent())
    expect(scrubbed.request?.headers).toEqual({
      'user-agent': 'Mozilla/5.0',
      'content-type': 'application/json',
      'x-contract-version': '2026-09-16.1',
    })
  })

  it('strips every IP/geo header, known or not, including ones no denylist could enumerate in advance', () => {
    const scrubbed = scrubEvent(realisticEvent())
    for (const header of [
      'authorization',
      'cookie',
      'x-client-ip',
      'x-forwarded-for',
      'x-real-ip',
      'x-vercel-forwarded-for',
      'x-vercel-ip-country',
      'x-vercel-ip-city',
      // Never listed anywhere — proves this is an allowlist, not a
      // denylist that merely grew a few more entries.
      'x-some-header-nobody-thought-of',
    ]) {
      expect(scrubbed.request?.headers?.[header]).toBeUndefined()
    }
  })

  it('redacts PII-shaped keys anywhere in extra/contexts, recursively', () => {
    const scrubbed = scrubEvent(realisticEvent())
    const submission = scrubbed.extra?.submission as Record<string, unknown>
    expect(submission.name).toBe('[Filtered]')
    expect(submission.surname).toBe('[Filtered]')
    expect(submission.email).toBe('[Filtered]')
    expect(submission.church).toBe('[Filtered]')
    expect(scrubbed.extra?.itemsTotalGel).toBe(27730)

    const customer = scrubbed.contexts?.customer as Record<string, unknown>
    expect(customer.phone).toBe('[Filtered]')
    expect(customer.ownerSecret).toBe('[Filtered]')
  })

  // Code review finding #3: the previous version of this test nested every
  // sensitive field under wrapper keys like `costing:`/`supplier:`/
  // `order:` — but those wrapper keys themselves match the pattern
  // (`costing` -> "cost", `supplier` -> "supplier"), so redactPII replaced
  // the *whole nested object* in one step and never actually recursed into
  // (or individually exercised) each child key. Removing any single term
  // from PII_KEY_PATTERN would therefore NOT have failed this test.
  //
  // Fixed by putting every sensitive field at the top level of `extra`, on
  // its own, and asserting each one individually — every real field name
  // from Costings/Suppliers/Orders (checked against src/collections/*.ts,
  // not guessed) that ADR 0005/D25 needs kept out of Sentry. Costings
  // fields without a tests/fixtures/sentinel.ts entry get a distinctive
  // local placeholder instead of inventing a project-wide sentinel value
  // for them. `itemsTotalGel` is the control: it must survive, proving
  // this isn't "redact everything in extra". Verified (manually, by
  // deleting each pattern term and re-running): removing any term below
  // fails this test EXCEPT `surname`, which is structurally redundant with
  // `name` (every "surname" contains "name" as a substring) and always
  // has been, since before this review round.
  it('drops every ADR 0005/D25 sensitive field individually — removing any one term from the pattern turns this red', () => {
    const sensitiveFields = {
      // Costings (ADR 0005 cardinal rule: supplier + cost secrecy)
      supplierUrl: SENTINEL.supplierUrl,
      supplierSku: SENTINEL.supplierSku,
      costRub: SENTINEL.costRub,
      logisticsGel: 452.3,
      costGel: 1234.56,
      otherCostsGel: 12,
      markupGel: 300,
      notes: SENTINEL.note,
      // Suppliers (naming or reaching the supplier directly lets a
      // competitor route around Samkvetlo, same reason as supplierName/Url)
      supplierName: SENTINEL.supplierName,
      website: 'https://a-real-supplier-site.invalid',
      contact: '+995500111222',
      // Orders (customer PII, D25)
      name: SENTINEL.orderCustomerName,
      surname: SENTINEL.orderCustomerSurname,
      phone: SENTINEL.orderCustomerPhone,
      email: SENTINEL.orderCustomerEmail,
      church: SENTINEL.orderCustomerChurch,
      comment: 'დარეკეთ საღამოს 6 საათის შემდეგ',
      city: 'ქუთაისი',
    }
    const controlField = { itemsTotalGel: 27730 }

    const scrubbed = scrubEvent({
      event_id: 'sentinel-1',
      level: 'error',
      exception: { values: [{ type: 'Error', value: 'costings.update failed' }] },
      extra: { ...sensitiveFields, ...controlField },
    } as Event)
    const result = scrubbed.extra as Record<string, unknown>

    for (const key of Object.keys(sensitiveFields)) {
      expect(result[key], `expected extra.${key} to be filtered`).toBe('[Filtered]')
    }
    expect(result.itemsTotalGel).toBe(27730)
  })

  it('leaves an event with no request/extra/contexts untouched', () => {
    const event: Event = { event_id: 'x', level: 'info' }
    expect(scrubEvent(event)).toEqual(event)
  })

  it('redacts the share-link token and its query string from a /s/* URL', () => {
    const event: Event = {
      request: { url: 'https://samkvetlo.ge/s/abcDEF123?utm_source=fb' },
    }
    expect(scrubEvent(event).request?.url).toBe('https://samkvetlo.ge/s/[token]')
  })

  // Code review finding m1: a query string can carry arbitrary user input
  // (an admin REST `where` filter, a search box) that no key-based
  // redaction ever inspects — e.g. `?where[phone][equals]=+995500...` puts
  // the phone number in the *value* of a query param, not a key scrubEvent
  // would ever see. Dropped for every URL now, not just /s/*.
  it('drops the query string from a non-/s/ URL entirely', () => {
    const event: Event = { request: { url: 'https://samkvetlo.ge/zarebi?coating=gilding' } }
    expect(scrubEvent(event).request?.url).toBe('https://samkvetlo.ge/zarebi')
  })

  it('drops a phone-number-carrying admin query string', () => {
    const event: Event = {
      request: { url: 'https://admin.samkvetlo.ge/api/orders?where[phone][equals]=+995500123456' },
    }
    expect(scrubEvent(event).request?.url).toBe('https://admin.samkvetlo.ge/api/orders')
  })

  // Code review finding m1: `@sentry/core`'s own request-data integration
  // populates `query_string` as a field independent of `url` and
  // independent of `sendDefaultPii` — so it must be dropped explicitly,
  // not just relied on via the url-stripping above.
  it('drops request.query_string entirely, regardless of its shape', () => {
    const asString: Event = { request: { url: 'https://samkvetlo.ge/x', query_string: 'phone=+995500123456' } }
    const asArray: Event = {
      request: { url: 'https://samkvetlo.ge/x', query_string: [['phone', '+995500123456']] },
    }
    expect(scrubEvent(asString).request?.query_string).toBeUndefined()
    expect(scrubEvent(asArray).request?.query_string).toBeUndefined()
  })
})

describe('scrubBreadcrumb', () => {
  it('redacts PII-shaped keys in breadcrumb data', () => {
    const breadcrumb: Breadcrumb = { category: 'fetch', data: { email: 'g@example.com', status: 200 } }
    const scrubbed = scrubBreadcrumb(breadcrumb)
    expect(scrubbed.data).toEqual({ email: '[Filtered]', status: 200 })
  })

  it('leaves a breadcrumb with no data untouched', () => {
    const breadcrumb: Breadcrumb = { category: 'navigation' }
    expect(scrubBreadcrumb(breadcrumb)).toEqual(breadcrumb)
  })
})
