import { ka } from '../../i18n/ka'
import { createBrevoEmailSender } from './brevoAdapter'
import { consoleEmailSender, consoleSmsSender } from './consoleAdapter'
import { NotifyConfigError } from './errors'
import { memoryEmailSender, memorySmsSender } from './memoryAdapter'
import { createSendergeSmsSender } from './sendergeAdapter'
import { createSmsofficeSmsSender } from './smsofficeAdapter'
import { createResendEmailSender } from './resendAdapter'
import type { EmailMessage, EmailSender, SmsMessage, SmsSender } from './types'

export type { EmailMessage, EmailSender, SmsMessage, SmsSender } from './types'
export { memoryEmailSender, memorySmsSender } from './memoryAdapter'
export { sendAndReport } from './sendAndReport'
export type { NotificationChannel, NotificationLogEntry } from './sendAndReport'
export { NotifyConfigError, ProviderError } from './errors'

function isProduction(): boolean {
  return process.env.VERCEL_ENV === 'production'
}

// A sender whose send() always rejects with the given config error — used
// so an unconfigured/misconfigured adapter fails loudly at send() time
// (ADR 0019 §5), never at import/build time.
function configErrorSender<Message>(code: 'missing_config' | 'not_configured'): {
  send: (message: Message) => Promise<void>
} {
  return {
    send: () => Promise.reject(new NotifyConfigError(code)),
  }
}

// ADR 0007: adapter choice is read on every call (not cached at import
// time), so a test can flip EMAIL_ADAPTER/SMS_ADAPTER at runtime and then
// inspect memoryEmailSender.sent / memorySmsSender.sent.
export function getEmailSender(): EmailSender {
  const adapter = process.env.EMAIL_ADAPTER
  if (adapter === undefined) {
    return isProduction() ? configErrorSender<EmailMessage>('not_configured') : consoleEmailSender
  }

  switch (adapter) {
    case 'console':
      return consoleEmailSender
    case 'memory':
      return memoryEmailSender
    case 'resend': {
      const apiKey = process.env.RESEND_API_KEY
      const fromAddress = process.env.EMAIL_FROM_ADDRESS
      if (!apiKey || !fromAddress) return configErrorSender<EmailMessage>('missing_config')
      return createResendEmailSender({ apiKey, fromAddress, fromName: emailFromName() })
    }
    case 'brevo': {
      const apiKey = process.env.BREVO_API_KEY
      const fromAddress = process.env.EMAIL_FROM_ADDRESS
      if (!apiKey || !fromAddress) return configErrorSender<EmailMessage>('missing_config')
      return createBrevoEmailSender({ apiKey, fromAddress, fromName: emailFromName() })
    }
    default:
      return configErrorSender<EmailMessage>('missing_config')
  }
}

export function getSmsSender(): SmsSender {
  const adapter = process.env.SMS_ADAPTER
  if (adapter === undefined) {
    return isProduction() ? configErrorSender<SmsMessage>('not_configured') : consoleSmsSender
  }

  switch (adapter) {
    case 'console':
      return consoleSmsSender
    case 'memory':
      return memorySmsSender
    case 'smsoffice': {
      const apiKey = process.env.SMSOFFICE_API_KEY
      if (!apiKey) return configErrorSender<SmsMessage>('missing_config')
      return createSmsofficeSmsSender({ apiKey, sender: process.env.SMSOFFICE_SENDER ?? 'Samkvetlo' })
    }
    case 'senderge': {
      const apiKey = process.env.SENDERGE_API_KEY
      if (!apiKey) return configErrorSender<SmsMessage>('missing_config')
      return createSendergeSmsSender({ apiKey })
    }
    default:
      return configErrorSender<SmsMessage>('missing_config')
  }
}

function emailFromName(): string {
  return process.env.EMAIL_FROM_NAME ?? ka.server.notify.emailFromName
}
