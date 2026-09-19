import { afterEach, describe, expect, it, vi } from 'vitest'

import { consoleEmailSender, consoleSmsSender } from '@/server/notify/consoleAdapter'
import { getEmailSender, getSmsSender } from '@/server/notify'
import { memoryEmailSender, memorySmsSender } from '@/server/notify/memoryAdapter'

// T5.18 (ADR 0019 §5): adapter selection is read from env on every call.
// A real send() is never exercised here (see notify-adapters.test.ts) —
// only which sender getEmailSender()/getSmsSender() hands back.
describe('notify adapter selection (ADR 0019)', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('EMAIL_ADAPTER=console/memory return the matching built-in sender', () => {
    vi.stubEnv('EMAIL_ADAPTER', 'console')
    expect(getEmailSender()).toBe(consoleEmailSender)
    vi.stubEnv('EMAIL_ADAPTER', 'memory')
    expect(getEmailSender()).toBe(memoryEmailSender)
  })

  it('SMS_ADAPTER=console/memory return the matching built-in sender', () => {
    vi.stubEnv('SMS_ADAPTER', 'console')
    expect(getSmsSender()).toBe(consoleSmsSender)
    vi.stubEnv('SMS_ADAPTER', 'memory')
    expect(getSmsSender()).toBe(memorySmsSender)
  })

  it('unset adapter + non-production env falls back to console (today\'s behavior)', () => {
    vi.stubEnv('EMAIL_ADAPTER', undefined)
    vi.stubEnv('VERCEL_ENV', undefined)
    expect(getEmailSender()).toBe(consoleEmailSender)
  })

  it('unset adapter + VERCEL_ENV=production throws NotifyConfigError(not_configured) at send()', async () => {
    vi.stubEnv('EMAIL_ADAPTER', undefined)
    vi.stubEnv('VERCEL_ENV', 'production')
    await expect(getEmailSender().send({ to: ['a@b.ge'], subject: 's', text: 't' })).rejects.toMatchObject({
      name: 'NotifyConfigError',
      code: 'not_configured',
    })
  })

  it('a console adapter is allowed even when VERCEL_ENV=production (staging)', () => {
    vi.stubEnv('EMAIL_ADAPTER', 'console')
    vi.stubEnv('VERCEL_ENV', 'production')
    expect(getEmailSender()).toBe(consoleEmailSender)
  })

  it('EMAIL_ADAPTER=resend without RESEND_API_KEY/EMAIL_FROM_ADDRESS -> missing_config at send(), fetch never called', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('EMAIL_ADAPTER', 'resend')
    vi.stubEnv('RESEND_API_KEY', undefined)
    vi.stubEnv('EMAIL_FROM_ADDRESS', undefined)

    await expect(getEmailSender().send({ to: ['a@b.ge'], subject: 's', text: 't' })).rejects.toMatchObject({
      name: 'NotifyConfigError',
      code: 'missing_config',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('EMAIL_ADAPTER=resend with both key and from address returns a working sender', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'x' }), { status: 200 })))
    vi.stubEnv('EMAIL_ADAPTER', 'resend')
    vi.stubEnv('RESEND_API_KEY', 're_test')
    vi.stubEnv('EMAIL_FROM_ADDRESS', 'shekvetebi@samkvetlo.ge')

    await expect(getEmailSender().send({ to: ['a@b.ge'], subject: 's', text: 't' })).resolves.toBeUndefined()
    vi.unstubAllGlobals()
  })

  it('SMS_ADAPTER=twilio (unknown adapter name) -> missing_config', async () => {
    vi.stubEnv('SMS_ADAPTER', 'twilio')
    await expect(getSmsSender().send({ to: ['599123456'], text: 't' })).rejects.toMatchObject({
      name: 'NotifyConfigError',
      code: 'missing_config',
    })
  })

  it('SMS_ADAPTER=smsoffice without SMSOFFICE_API_KEY -> missing_config', async () => {
    vi.stubEnv('SMS_ADAPTER', 'smsoffice')
    vi.stubEnv('SMSOFFICE_API_KEY', undefined)
    await expect(getSmsSender().send({ to: ['599123456'], text: 't' })).rejects.toMatchObject({ code: 'missing_config' })
  })

  it('SMS_ADAPTER=senderge without SENDERGE_API_KEY -> missing_config', async () => {
    vi.stubEnv('SMS_ADAPTER', 'senderge')
    vi.stubEnv('SENDERGE_API_KEY', undefined)
    await expect(getSmsSender().send({ to: ['599123456'], text: 't' })).rejects.toMatchObject({ code: 'missing_config' })
  })
})
