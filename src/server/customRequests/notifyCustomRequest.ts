import type { Payload } from 'payload'

import type { CustomRequest } from '../../payload-types'
import { getEmailSender, getSmsSender } from '../notify'
import { buildOwnerCustomRequestEmail, buildOwnerCustomRequestSms } from '../notify/templates/customRequestCreated'

interface NotificationEntry {
  channel: 'email' | 'sms'
  status: 'sent' | 'failed'
  error?: string
  at: string
}

function adminCustomRequestUrl(id: number | string): string {
  return `${process.env.BACKEND_URL ?? ''}/admin/collections/custom-requests/${id}`
}

/**
 * ADR 0011 §3 / ADR 0007 §4/§6: customRequest.created — owner email + SMS
 * only (no customer channel, unlike orders — the owner calls the client
 * back). Fires after the request is already saved; every channel is
 * wrapped in Promise.allSettled so an adapter exception never fails the
 * submission. Result written to customRequest.notifications[]. This whole
 * function also can't throw into `submitCustomRequest` (review finding
 * MINOR 3): `findGlobal` and everything else here used to run outside any
 * try/catch, so a transient failure there turned an already-saved request
 * into a 500 with no request number shown to the customer. The outer catch
 * logs only the request id/number — never PII.
 */
export async function notifyCustomRequestCreated(payload: Payload, request: CustomRequest): Promise<void> {
  try {
    await sendCustomRequestNotifications(payload, request)
  } catch (err: unknown) {
    payload.logger.error(
      { err, requestId: request.id, requestNumber: request.number },
      'notifyCustomRequestCreated failed',
    )
  }
}

async function sendCustomRequestNotifications(payload: Payload, request: CustomRequest): Promise<void> {
  const settings = await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })
  const ownerEmails = (settings.ownerEmails ?? [])
    .map((entry) => entry.email)
    .filter((email): email is string => Boolean(email))
  const ownerPhones = (settings.ownerPhones ?? [])
    .map((entry) => entry.phone)
    .filter((phone): phone is string => Boolean(phone))

  const channels: Array<{ channel: 'email' | 'sms'; run: () => Promise<void> }> = []

  if (ownerEmails.length > 0) {
    const message = buildOwnerCustomRequestEmail(request, adminCustomRequestUrl(request.id))
    channels.push({
      channel: 'email',
      run: () => getEmailSender().send({ to: ownerEmails, subject: message.subject, text: message.text }),
    })
  }

  if (ownerPhones.length > 0) {
    const text = buildOwnerCustomRequestSms(request)
    channels.push({ channel: 'sms', run: () => getSmsSender().send({ to: ownerPhones, text }) })
  }

  if (channels.length === 0) return

  const settled = await Promise.allSettled(channels.map((entry) => entry.run()))
  const notifications: NotificationEntry[] = settled.map((result, index) => {
    const channel = channels[index]!.channel
    const at = new Date().toISOString()
    return result.status === 'fulfilled'
      ? { channel, status: 'sent', at }
      : { channel, status: 'failed', error: String(result.reason), at }
  })

  await payload
    .update({ collection: 'custom-requests', id: request.id, data: { notifications }, overrideAccess: true })
    .catch((err: unknown) => {
      payload.logger.error(
        { err, requestId: request.id },
        'notifyCustomRequestCreated: failed to persist notifications[]',
      )
    })

  // ADR 0014 §11 (Sentry lands in T5.10) — for now, a failed notification is
  // at least visible in the server log. Never PII: only the id/number/channel.
  for (const entry of notifications) {
    if (entry.status === 'failed') {
      payload.logger.error(
        { requestId: request.id, requestNumber: request.number, channel: entry.channel },
        'custom request notification failed',
      )
    }
  }
}
