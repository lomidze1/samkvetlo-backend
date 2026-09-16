import type { Payload } from 'payload'

import type { Order } from '../../payload-types'
import { getEmailSender, getSmsSender } from '../notify'
import { buildCustomerOrderText, buildOwnerOrderEmail, buildOwnerOrderSms } from '../notify/templates/orderCreated'

interface NotificationEntry {
  channel: 'email' | 'sms'
  status: 'sent' | 'failed'
  error?: string
  at: string
}

function adminOrderUrl(orderId: number | string): string {
  return `${process.env.BACKEND_URL ?? ''}/admin/collections/orders/${orderId}`
}

/**
 * ADR 0007 §4/§6: fires after the order is already saved. Every channel is
 * wrapped in Promise.allSettled — an adapter exception never fails the
 * order (submitOrder calls this without a try/catch around it). The result
 * of each attempt is written to order.notifications[] (channel/status/error/at).
 */
export async function notifyOrderCreated(payload: Payload, order: Order): Promise<void> {
  const settings = await payload.findGlobal({ slug: 'site-settings', overrideAccess: true })
  const ownerEmails = (settings.ownerEmails ?? [])
    .map((entry) => entry.email)
    .filter((email): email is string => Boolean(email))
  const ownerPhones = (settings.ownerPhones ?? [])
    .map((entry) => entry.phone)
    .filter((phone): phone is string => Boolean(phone))

  const channels: Array<{ channel: 'email' | 'sms'; run: () => Promise<void> }> = []

  if (ownerEmails.length > 0) {
    const message = buildOwnerOrderEmail(order, adminOrderUrl(order.id))
    channels.push({
      channel: 'email',
      run: () => getEmailSender().send({ to: ownerEmails, subject: message.subject, text: message.text }),
    })
  }

  if (ownerPhones.length > 0) {
    const text = buildOwnerOrderSms(order)
    channels.push({ channel: 'sms', run: () => getSmsSender().send({ to: ownerPhones, text }) })
  }

  if (settings.notifyCustomer) {
    const text = buildCustomerOrderText(order)
    channels.push({ channel: 'sms', run: () => getSmsSender().send({ to: [order.phone], text }) })
    if (order.email) {
      const email = order.email
      channels.push({
        channel: 'email',
        run: () => getEmailSender().send({ to: [email], subject: text, text }),
      })
    }
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
    .update({ collection: 'orders', id: order.id, data: { notifications }, overrideAccess: true })
    .catch((err: unknown) => {
      payload.logger.error({ err, orderId: order.id }, 'notifyOrderCreated: failed to persist notifications[]')
    })

  // ADR 0014 §11 (Sentry captureMessage lands in T5.10) — for now, a failed
  // notification is at least visible in the server log. Never PII: only
  // the order id/number and channel.
  for (const entry of notifications) {
    if (entry.status === 'failed') {
      payload.logger.error(
        { orderId: order.id, orderNumber: order.number, channel: entry.channel },
        'order notification failed',
      )
    }
  }
}
