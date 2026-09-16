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

  // Code review finding: ADR 0005's cardinal rule is supplier/costing
  // secrecy, and the old pattern let supplierUrl/supplierSku/costRub/
  // markup pass straight through — a costing error's `extra` would have
  // shipped ₽ cost and a supplier URL to Sentry. This feeds the same
  // SENTINEL values other secrecy tests use (tests/fixtures/sentinel.ts),
  // under the real field names they come from (Costings/Orders), and
  // checks none of them survive anywhere in the scrubbed JSON — not just
  // under the one key each test above happens to check.
  //
  // Excluded on purpose: SENTINEL.filename and SENTINEL.shareLinkTtlDays.
  // Neither is a Sentry-scrub secrecy concern — filename is scrubbed by
  // the upload rename hook before it ever reaches a public response (ADR
  // 0005 layer 4), and shareLinkTtlDays is a non-secret admin setting that
  // only borrows the 987654 pattern for an unrelated public-DTO leak test.
  it('drops every ADR 0005/D25 SENTINEL value anywhere in a realistic costing+order failure event', () => {
    const event: Event = {
      event_id: 'sentinel-1',
      level: 'error',
      exception: { values: [{ type: 'Error', value: 'costings.update failed' }] },
      extra: {
        costing: {
          supplierUrl: SENTINEL.supplierUrl,
          supplierSku: SENTINEL.supplierSku,
          costRub: SENTINEL.costRub,
        },
        supplier: { name: SENTINEL.supplierName },
        order: {
          name: SENTINEL.orderCustomerName,
          surname: SENTINEL.orderCustomerSurname,
          phone: SENTINEL.orderCustomerPhone,
          email: SENTINEL.orderCustomerEmail,
          church: SENTINEL.orderCustomerChurch,
        },
        ownerEmails: [{ email: SENTINEL.ownerEmail }],
        ownerPhones: [{ phone: SENTINEL.ownerPhone }],
      },
    }

    const scrubbedJson = JSON.stringify(scrubEvent(event))
    for (const [key, value] of Object.entries(SENTINEL)) {
      if (key === 'filename' || key === 'shareLinkTtlDays') continue
      expect(scrubbedJson).not.toContain(String(value))
    }
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

  it('leaves a non-/s/ URL query string alone', () => {
    const event: Event = { request: { url: 'https://samkvetlo.ge/zarebi?coating=gilding' } }
    expect(scrubEvent(event).request?.url).toBe('https://samkvetlo.ge/zarebi?coating=gilding')
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
