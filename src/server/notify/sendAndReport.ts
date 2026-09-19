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

interface ErrorSummary {
  code?: number | string
  name?: string
}

/**
 * Code review finding: a provider's raw error message routinely echoes back
 * the offending value — e.g. `Invalid 'to' field: someone@example.com` — so
 * forwarding `.message` to Sentry would ship a customer's email/phone right
 * past `scrubEvent`'s key-based redaction (it only inspects keys, never
 * values). Only the error's `name` (e.g. `Error`, `TypeError`) and, if the
 * provider set one, a `code`/`statusCode`/`status` — plain string/number
 * fields that describe the failure kind, never free text — are safe to
 * send. Everything else about the failure stays in `notifications[].error`
 * (admin-only, never sent anywhere).
 */
function summarizeForSentry(reason: unknown): ErrorSummary {
  if (!(reason instanceof Error)) return {}
  const withCode = reason as Error & { code?: unknown; status?: unknown; statusCode?: unknown }
  const code = withCode.code ?? withCode.statusCode ?? withCode.status
  return {
    name: reason.name,
    ...(typeof code === 'string' || typeof code === 'number' ? { code } : {}),
  }
}

/**
 * ADR 0007 §6: delivery is `Promise.allSettled` — a failed channel must
 * never throw into the caller (order/custom-request creation) or block the
 * other channel. The return value is written verbatim into the record's
 * `notifications[]` array — including the raw provider error, which is
 * admin-only and never leaves the database.
 *
 * ADR 0014 §11: a `failed` entry is also reported to Sentry
 * (`captureMessage`, no DSN = no-op) so the owner learns about a lost
 * email/SMS even if the admin's ⚠ badge is missed. Only the channel and a
 * summary of the error's *kind* (name/code) are sent — never the message
 * body, `to` addresses, the raw error message, or any other PII.
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
      extra: { channel, ...summarizeForSentry(result.reason) },
    })
    return { at, channel, error, status: 'failed' }
  })
}
