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

  it('reports "failed" with the raw error message in the log entry, but sends only name/code to Sentry', async () => {
    const send = vi.fn().mockRejectedValue(new Error('smtp timeout'))
    const [entry] = await sendAndReport([{ channel: 'sms', send }])

    expect(entry).toMatchObject({ channel: 'sms', status: 'failed', error: 'smtp timeout' })
    expect(captureMessage).toHaveBeenCalledTimes(1)
    expect(captureMessage).toHaveBeenCalledWith(
      'notification failed: sms',
      expect.objectContaining({ level: 'warning', extra: { channel: 'sms', name: 'Error' } }),
    )
  })

  // Code review finding: a real provider bounce routinely echoes the
  // offending value back in its message (e.g. a bad recipient address) —
  // that must never reach Sentry, only the log entry (admin-only, ADR
  // 0014 §11/D25).
  it('never sends a raw provider error message — including one containing a customer email/phone — to Sentry', async () => {
    const providerError = new Error(
      "Invalid 'to' field: someone@example.com is not deliverable (contact +995500123456)",
    )
    const send = vi.fn().mockRejectedValue(providerError)
    const [entry] = await sendAndReport([{ channel: 'email', send }])

    // The full message is still available where only the admin sees it.
    expect(entry?.error).toContain('someone@example.com')

    expect(captureMessage).toHaveBeenCalledTimes(1)
    const [, captureArgs] = captureMessage.mock.calls[0]!
    const sentPayload = JSON.stringify(captureArgs)
    expect(sentPayload).not.toContain('someone@example.com')
    expect(sentPayload).not.toContain('+995500123456')
    expect(sentPayload).not.toContain(providerError.message)
    expect(captureArgs.extra).toEqual({ channel: 'email', name: 'Error' })
  })

  it('forwards a provider error code (e.g. an SMTP/HTTP status) alongside the name', async () => {
    const providerError = Object.assign(new Error('550 mailbox unavailable: jane@example.com'), { code: 550 })
    const send = vi.fn().mockRejectedValue(providerError)
    await sendAndReport([{ channel: 'email', send }])

    const [, captureArgs] = captureMessage.mock.calls[0]!
    expect(captureArgs.extra).toEqual({ channel: 'email', name: 'Error', code: 550 })
    expect(JSON.stringify(captureArgs)).not.toContain('jane@example.com')
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
