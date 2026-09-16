import { describe, expect, it } from 'vitest'
import type { Breadcrumb, Event } from '@sentry/nextjs'

import { scrubBreadcrumb, scrubEvent } from '@/lib/security/scrubEvent'

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
        'user-agent': 'Mozilla/5.0',
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

  it('strips the authorization/cookie/x-client-ip headers but keeps others', () => {
    const scrubbed = scrubEvent(realisticEvent())
    expect(scrubbed.request?.headers?.authorization).toBeUndefined()
    expect(scrubbed.request?.headers?.cookie).toBeUndefined()
    expect(scrubbed.request?.headers?.['x-client-ip']).toBeUndefined()
    expect(scrubbed.request?.headers?.['user-agent']).toBe('Mozilla/5.0')
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
