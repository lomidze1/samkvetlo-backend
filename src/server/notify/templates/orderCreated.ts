import type { Order } from '../../../payload-types'
import { ka } from '../../../i18n/ka'
import { formatGel } from '../../../lib/format'

export interface OwnerOrderEmail {
  subject: string
  text: string
}

function surnameInitial(surname: string): string {
  return surname.trim().charAt(0)
}

/** "+995599123456" -> "599 123 456" (ADR 0007 §4's "5XX XXX XXX" shape). */
function groupPhone(phone: string): string {
  const national = phone.replace(/\D/g, '').replace(/^995/, '')
  const match = national.match(/^(\d{3})(\d{3})(\d{3})$/)
  return match ? `${match[1]} ${match[2]} ${match[3]}` : phone
}

/** ADR 0007 §4: owner email — number, lines, delivery zone + fee, total, admin link. */
export function buildOwnerOrderEmail(order: Order, adminUrl: string): OwnerOrderEmail {
  const lines = (order.items ?? []).map((item) =>
    ka.server.notify.orderCreated.ownerEmailLine(
      item.productTitle,
      item.variantTitle,
      item.qty,
      formatGel(item.unitPrice),
      formatGel(item.lineTotal ?? item.unitPrice * item.qty),
    ),
  )

  const deliveryLine = ka.server.notify.orderCreated.ownerEmailDeliveryLine(
    order.deliveryZone?.name ?? '',
    formatGel(order.deliveryFeeGel ?? 0),
  )
  const totalLine = ka.server.notify.orderCreated.ownerEmailTotalLine(formatGel(order.totalGel ?? 0))
  const adminLine = ka.server.notify.orderCreated.ownerEmailAdminLink(adminUrl)

  return {
    subject: ka.server.notify.orderCreated.ownerEmailSubject(order.number ?? ''),
    text: [...lines, deliveryLine, totalLine, adminLine].join('\n'),
  }
}

/** ADR 0007 §4: owner SMS, <= 140 chars. */
export function buildOwnerOrderSms(order: Order): string {
  return ka.server.notify.orderCreated.ownerSms(
    order.number ?? '',
    formatGel(order.totalGel ?? 0),
    order.name,
    surnameInitial(order.surname),
    groupPhone(order.phone),
  )
}

/** D17 (ADR 0007 §4): customer email/SMS text, sent only when notifyCustomer is true. */
export function buildCustomerOrderText(order: Order): string {
  return ka.server.notify.orderCreated.customerText(order.number ?? '')
}
