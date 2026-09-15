import { afterEach, describe, expect, it, vi } from 'vitest'

import { consoleEmailSender, consoleSmsSender } from '@/server/notify/consoleAdapter'
import { getEmailSender, getSmsSender } from '@/server/notify/index'
import { memoryEmailSender, memorySmsSender } from '@/server/notify/memoryAdapter'

// T1.5 (ADR 0007): console adapter prints to stdout in dev; memory adapter
// collects messages for tests. Neither talks to a real provider.
describe('notify adapters (T1.5)', () => {
  afterEach(() => {
    memoryEmailSender.reset()
    memorySmsSender.reset()
    delete process.env.EMAIL_ADAPTER
    delete process.env.SMS_ADAPTER
  })

  it('console adapter prints [email]/[sms] to stdout', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await consoleEmailSender.send({ to: ['owner@samkvetlo.local'], subject: 'ახალი შეკვეთა', text: 'დეტალები' })
    await consoleSmsSender.send({ to: ['+995500000000'], text: 'ახალი შეკვეთა SMK-2026-000001' })

    expect(logSpy.mock.calls.some((call) => String(call[0]).startsWith('[email] to=owner@samkvetlo.local'))).toBe(
      true,
    )
    expect(
      logSpy.mock.calls.some((call) => String(call[0]).startsWith('[sms] to=+995500000000')),
    ).toBe(true)

    logSpy.mockRestore()
  })

  it('memory adapter collects sent messages instead of delivering them', async () => {
    process.env.EMAIL_ADAPTER = 'memory'
    process.env.SMS_ADAPTER = 'memory'

    await getEmailSender().send({ to: ['owner@samkvetlo.local'], subject: 'test', text: 'body' })
    await getSmsSender().send({ to: ['+995500000000'], text: 'test' })

    expect(memoryEmailSender.sent).toHaveLength(1)
    expect(memoryEmailSender.sent[0]).toMatchObject({ subject: 'test' })
    expect(memorySmsSender.sent).toHaveLength(1)
  })

  it('defaults to the console adapter when EMAIL_ADAPTER/SMS_ADAPTER are unset', () => {
    expect(getEmailSender()).toBe(consoleEmailSender)
    expect(getSmsSender()).toBe(consoleSmsSender)
  })
})
