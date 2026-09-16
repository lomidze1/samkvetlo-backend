import { afterEach, describe, expect, it, vi } from 'vitest'

const captureMessage = vi.fn()
vi.mock('@sentry/nextjs', () => ({ captureMessage }))

// Imported after the mock so sendAndReport picks up the mocked module.
const { sendAndReport } = await import('@/server/notify/sendAndReport')

// T5.10 (ADR 0007 §6, ADR 0014 §11): wires the notifications[].failed path
// to Sentry.captureMessage, with no DSN this is a no-op call into an
// uninitialized SDK — that's exercised by instrumentation.ts, not here.
describe('sendAndReport', () => {
  afterEach(() => {
    captureMessage.mockClear()
  })

  it('reports "sent" for a fulfilled attempt and does not call Sentry', async () => {
    const send = vi.fn().mockResolvedValue(undefined)
    const [entry] = await sendAndReport([{ channel: 'email', send }])

    expect(entry).toMatchObject({ channel: 'email', status: 'sent' })
    expect(entry?.error).toBeUndefined()
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('reports "failed" with the error message and calls Sentry.captureMessage, without the message body', async () => {
    const send = vi.fn().mockRejectedValue(new Error('smtp timeout'))
    const [entry] = await sendAndReport([{ channel: 'sms', send }])

    expect(entry).toMatchObject({ channel: 'sms', status: 'failed', error: 'smtp timeout' })
    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(captureMessage).toHaveBeenCalledWith(
      'notification failed: sms',
      expect.objectContaining({ level: 'warning', extra: { channel: 'sms', error: 'smtp timeout' } }),
    )
  })

  it('handles a non-Error rejection reason as a string', async () => {
    const send = vi.fn().mockRejectedValue('provider down')
    const [entry] = await sendAndReport([{ channel: 'email', send }])

    expect(entry?.error).toBe('provider down')
  })

  it('one failed channel does not block or affect the other (Promise.allSettled)', async () => {
    const emailSend = vi.fn().mockResolvedValue(undefined)
    const smsSend = vi.fn().mockRejectedValue(new Error('boom'))

    const results = await sendAndReport([
      { channel: 'email', send: emailSend },
      { channel: 'sms', send: smsSend },
    ])

    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ channel: 'email', status: 'sent' })
    expect(results[1]).toMatchObject({ channel: 'sms', status: 'failed' })
    expect(captureMessage).toHaveBeenCalledTimes(1)
  })
})
