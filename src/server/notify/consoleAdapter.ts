import type { EmailMessage, EmailSender, SmsMessage, SmsSender } from './types'

// ADR 0007: dev default (no email/SMS provider configured yet) — prints the
// full message so a developer can see exactly what would have been sent.
export const consoleEmailSender: EmailSender = {
  async send(message: EmailMessage): Promise<void> {
    console.log(`[email] to=${message.to.join(',')} subject=${message.subject}`)
    console.log(message.text)
  },
}

export const consoleSmsSender: SmsSender = {
  async send(message: SmsMessage): Promise<void> {
    console.log(`[sms] to=${message.to.join(',')} text=${message.text}`)
  },
}
