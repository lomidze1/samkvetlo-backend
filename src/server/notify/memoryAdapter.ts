import type { EmailMessage, EmailSender, SmsMessage, SmsSender } from './types'

// ADR 0007: test-only adapter — collects sent messages instead of printing
// or delivering them, so tests can assert on exactly what was "sent".
export interface MemorySender<Message> {
  reset(): void
  send(message: Message): Promise<void>
  sent: Message[]
}

function createMemorySender<Message>(): MemorySender<Message> {
  const sent: Message[] = []
  return {
    sent,
    async send(message: Message): Promise<void> {
      sent.push(message)
    },
    reset(): void {
      sent.length = 0
    },
  }
}

// Module-level singletons: getEmailSender()/getSmsSender() (index.ts) return
// these same instances whenever EMAIL_ADAPTER/SMS_ADAPTER=memory, so a test
// can read `memoryEmailSender.sent` after triggering some server action.
export const memoryEmailSender: MemorySender<EmailMessage> & EmailSender = createMemorySender<EmailMessage>()
export const memorySmsSender: MemorySender<SmsMessage> & SmsSender = createMemorySender<SmsMessage>()
