import { ProviderError } from './errors'
import type { EmailMessage, EmailSender } from './types'

export interface ResendConfig {
  apiKey: string
  fromAddress: string
  fromName: string
}

interface ResendErrorBody {
  name?: string
}

// ADR 0019: plain fetch, no SDK. `html` is left `undefined` when the caller
// didn't set one — JSON.stringify drops `undefined` properties, so the key
// is simply absent from the body.
export function createResendEmailSender(config: ResendConfig): EmailSender {
  return {
    async send(message: EmailMessage): Promise<void> {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${config.fromName} <${config.fromAddress}>`,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (response.ok) return

      const body = (await response.json().catch(() => ({}))) as ResendErrorBody
      throw new ProviderError(body.name ?? response.status, response.status)
    },
  }
}
