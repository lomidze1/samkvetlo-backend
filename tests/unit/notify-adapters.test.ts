import { afterEach, describe, expect, it, vi } from 'vitest'

import { createBrevoEmailSender } from '@/server/notify/brevoAdapter'
import { ProviderError } from '@/server/notify/errors'
import { createResendEmailSender } from '@/server/notify/resendAdapter'
import { createSendergeSmsSender } from '@/server/notify/sendergeAdapter'
import { createSmsofficeSmsSender } from '@/server/notify/smsofficeAdapter'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status })
}

// T5.18 (ADR 0019): every adapter is plain `fetch` — these tests stub the
// global and assert the exact request shape from the ADR's contract table,
// plus that a provider error never leaks the recipient/body into `message`.
describe('notify adapters (ADR 0019)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('resendAdapter', () => {
    const config = { apiKey: 're_test_SENTINEL', fromAddress: 'shekvetebi@samkvetlo.ge', fromName: 'სამკვეთლო' }

    it('sends the exact request shape and omits html when unset', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { id: 'abc' }))
      vi.stubGlobal('fetch', fetchMock)

      await createResendEmailSender(config).send({ to: ['owner@samkvetlo.local'], subject: 'ს', text: 'ტ' })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe('https://api.resend.com/emails')
      expect(init.method).toBe('POST')
      expect(init.headers).toEqual({ Authorization: 'Bearer re_test_SENTINEL', 'Content-Type': 'application/json' })
      expect(init.signal).toBeInstanceOf(AbortSignal)

      const body = JSON.parse(init.body as string)
      expect(Object.keys(body).sort()).toEqual(['from', 'subject', 'text', 'to'])
      expect(body).toEqual({ from: 'სამკვეთლო <shekvetebi@samkvetlo.ge>', to: ['owner@samkvetlo.local'], subject: 'ს', text: 'ტ' })
    })

    it('includes html when the message has one', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { id: 'abc' })))
      await createResendEmailSender(config).send({ to: ['a@b.ge'], subject: 's', text: 't', html: '<p>t</p>' })
      const body = JSON.parse((vi.mocked(fetch).mock.calls[0]![1] as RequestInit).body as string)
      expect(body.html).toBe('<p>t</p>')
    })

    it('a 422 validation error becomes a ProviderError without leaking the recipient', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(422, { name: 'validation_error', message: 'Invalid to field: x@y.ge' })),
      )

      await expect(
        createResendEmailSender(config).send({ to: ['x@y.ge'], subject: 's', text: 't' }),
      ).rejects.toMatchObject({ name: 'ProviderError', code: 'validation_error' })

      try {
        await createResendEmailSender(config).send({ to: ['x@y.ge'], subject: 's', text: 't' })
        expect.unreachable()
      } catch (err) {
        expect((err as Error).message).not.toContain('x@y.ge')
      }
    })

    it('a 429 without a name falls back to the HTTP status as the code', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(429, {})))
      await expect(createResendEmailSender(config).send({ to: ['a@b.ge'], subject: 's', text: 't' })).rejects.toMatchObject({
        code: 429,
      })
    })

    it('propagates a fetch rejection (timeout/network) without wrapping it', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError')
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError))
      await expect(createResendEmailSender(config).send({ to: ['a@b.ge'], subject: 's', text: 't' })).rejects.toBe(abortError)
    })
  })

  describe('brevoAdapter', () => {
    const config = { apiKey: 'xkeysib-test-SENTINEL', fromAddress: 'shekvetebi@samkvetlo.ge', fromName: 'სამკვეთლო' }

    it('sends the exact request shape', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { messageId: 'm1' }))
      vi.stubGlobal('fetch', fetchMock)

      await createBrevoEmailSender(config).send({ to: ['owner@samkvetlo.local'], subject: 'ს', text: 'ტ' })

      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe('https://api.brevo.com/v3/smtp/email')
      expect(init.headers).toEqual({ 'api-key': 'xkeysib-test-SENTINEL', 'Content-Type': 'application/json' })
      const body = JSON.parse(init.body as string)
      expect(body).toEqual({
        sender: { email: 'shekvetebi@samkvetlo.ge', name: 'სამკვეთლო' },
        to: [{ email: 'owner@samkvetlo.local' }],
        subject: 'ს',
        textContent: 'ტ',
      })
    })

    it('a 401 unauthorized becomes a ProviderError keyed by the provider code', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(jsonResponse(401, { code: 'unauthorized', message: 'unrecognised IP address x' })),
      )
      await expect(createBrevoEmailSender(config).send({ to: ['a@b.ge'], subject: 's', text: 't' })).rejects.toMatchObject({
        code: 'unauthorized',
      })
    })
  })

  describe('smsofficeAdapter', () => {
    const config = { apiKey: 'sms_test_SENTINEL', sender: 'Samkvetlo' }

    it('sends all recipients in one request, key in the body (not the URL), urgent=true', async () => {
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { Success: true, ErrorCode: 0 }))
      vi.stubGlobal('fetch', fetchMock)

      await createSmsofficeSmsSender(config).send({ to: ['+995 593 50 20 93', '593502093'], text: 'ტესტი' })

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe('https://smsoffice.ge/api/v2/send/')
      expect(init.body).toBeInstanceOf(URLSearchParams)
      expect(url).not.toContain('sms_test_SENTINEL')

      const params = new URLSearchParams(init.body as URLSearchParams)
      expect(params.get('key')).toBe('sms_test_SENTINEL')
      expect(params.get('destination')).toBe('995593502093,995593502093')
      expect(params.get('urgent')).toBe('true')
      expect(params.get('sender')).toBe('Samkvetlo')
      expect(params.get('content')).toBe('ტესტი')
    })

    it('a non-zero ErrorCode is a ProviderError even with HTTP 200', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { Success: false, ErrorCode: 20, Message: 'no balance' })))
      await expect(createSmsofficeSmsSender(config).send({ to: ['599123456'], text: 't' })).rejects.toMatchObject({
        name: 'ProviderError',
        code: 20,
      })
    })

    it('an invalid recipient rejects before calling fetch', async () => {
      const fetchMock = vi.fn()
      vi.stubGlobal('fetch', fetchMock)
      await expect(createSmsofficeSmsSender(config).send({ to: ['12345'], text: 't' })).rejects.toMatchObject({
        code: 'invalid_recipient',
      })
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('sendergeAdapter', () => {
    const config = { apiKey: 'sg_test_SENTINEL' }

    it('sends one request per number, 9-digit destination, smsno=2', async () => {
      // A fresh Response per call — a Response body can only be read once,
      // and the adapter calls response.json() for each of the two requests.
      const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(200, { statusId: 1 })))
      vi.stubGlobal('fetch', fetchMock)

      await createSendergeSmsSender(config).send({ to: ['593502093', '599111222'], text: 'ტ' })

      expect(fetchMock).toHaveBeenCalledTimes(2)
      const firstParams = new URLSearchParams(fetchMock.mock.calls[0]![1].body as URLSearchParams)
      expect(firstParams.get('destination')).toBe('593502093')
      expect(firstParams.get('smsno')).toBe('2')
      const secondParams = new URLSearchParams(fetchMock.mock.calls[1]![1].body as URLSearchParams)
      expect(secondParams.get('destination')).toBe('599111222')
    })

    it('a 402 response becomes a ProviderError keyed by the HTTP status', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 402 })))
      await expect(createSendergeSmsSender(config).send({ to: ['593502093'], text: 't' })).rejects.toMatchObject({ code: 402 })
    })

    it('statusId !== 1 on a 200 response is still a ProviderError', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { statusId: 0 })))
      await expect(createSendergeSmsSender(config).send({ to: ['593502093'], text: 't' })).rejects.toBeInstanceOf(ProviderError)
    })
  })
})
