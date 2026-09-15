// ADR 0007: two minimal ports. Adapters (console/memory now; smtp/resend
// later, once a provider ADR exists) live only in samkvetlo-backend —
// frontend never sends a notification directly.
export interface EmailMessage {
  html?: string
  subject: string
  text: string
  to: string[]
}

export interface SmsMessage {
  text: string
  to: string[]
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>
}

export interface SmsSender {
  send(message: SmsMessage): Promise<void>
}
