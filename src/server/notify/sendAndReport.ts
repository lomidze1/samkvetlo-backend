import * as Sentry from '@sentry/nextjs'

export type NotificationChannel = 'email' | 'sms'

export interface NotificationLogEntry {
  at: string
  channel: NotificationChannel
  error?: string
  status: 'failed' | 'sent'
}

interface NotificationAttempt {
  channel: NotificationChannel
  send: () => Promise<void>
}

/**
 * ADR 0007 §6: delivery is `Promise.allSettled` — a failed channel must
 * never throw into the caller (order/custom-request creation) or block the
 * other channel. The return value is written verbatim into the record's
 * `notifications[]` array.
 *
 * ADR 0014 §11: a `failed` entry is also reported to Sentry
 * (`captureMessage`, no DSN = no-op) so the owner learns about a lost
 * email/SMS even if the admin's ⚠ badge is missed. Only the channel and the
 * provider's own error message are sent — never the message body, `to`
 * addresses, or any other PII.
 */
export async function sendAndReport(attempts: NotificationAttempt[]): Promise<NotificationLogEntry[]> {
  const settled = await Promise.allSettled(attempts.map((attempt) => attempt.send()))

  return settled.map((result, index) => {
    const { channel } = attempts[index]!
    const at = new Date().toISOString()

    if (result.status === 'fulfilled') {
      return { at, channel, status: 'sent' }
    }

    const error = result.reason instanceof Error ? result.reason.message : String(result.reason)
    Sentry.captureMessage(`notification failed: ${channel}`, {
      level: 'warning',
      extra: { channel, error },
    })
    return { at, channel, error, status: 'failed' }
  })
}
