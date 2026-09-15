import { consoleEmailSender, consoleSmsSender } from './consoleAdapter'
import { memoryEmailSender, memorySmsSender } from './memoryAdapter'
import type { EmailSender, SmsSender } from './types'

export type { EmailMessage, EmailSender, SmsMessage, SmsSender } from './types'
export { memoryEmailSender, memorySmsSender } from './memoryAdapter'

// ADR 0007: adapter choice is read on every call (not cached at import
// time), so a test can flip EMAIL_ADAPTER/SMS_ADAPTER=memory at runtime and
// then inspect memoryEmailSender.sent / memorySmsSender.sent.
export function getEmailSender(): EmailSender {
  return process.env.EMAIL_ADAPTER === 'memory' ? memoryEmailSender : consoleEmailSender
}

export function getSmsSender(): SmsSender {
  return process.env.SMS_ADAPTER === 'memory' ? memorySmsSender : consoleSmsSender
}
