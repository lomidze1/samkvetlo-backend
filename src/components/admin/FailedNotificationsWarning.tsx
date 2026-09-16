'use client'

import { Banner, useDocumentInfo } from '@payloadcms/ui'

import type { Order } from '../../payload-types'
import { hasFailedNotification } from './hasFailedNotification'

// ADR 0007 §6: "შეცდომა checkout-ს არ აფუჭებს; ადმინში ჩანს ⚠". UI field
// placed near the top of the Orders edit view (Orders.ts) so a failed
// SMS/email is impossible to miss. Renders nothing when every notification
// succeeded (or none were sent yet).
export function FailedNotificationsWarning() {
  const { data } = useDocumentInfo()
  const notifications = data?.notifications as Order['notifications'] | undefined

  if (!hasFailedNotification(notifications)) return null

  return <Banner type="error">⚠ ერთი ან მეტი შეტყობინება ვერ გაიგზავნა — იხილეთ „შეტყობინებები“ ქვემოთ.</Banner>
}
