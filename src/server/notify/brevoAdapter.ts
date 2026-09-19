import { ProviderError } from './errors'
import type { EmailMessage, EmailSender } from './types'

export interface BrevoConfig {
  apiKey: string
  fromAddress: string
  fromName: string
}

interface BrevoErrorBody {
  code?: string
}

// ADR 0019: fallback email provider, plain fetch. Success is HTTP 201 with
// `{ messageId }` — anything else is a ProviderError keyed by the
// provider's own `code`.
export function createBrevoEmailSender(config: BrevoConfig): EmailSender {
  return {
    async send(message: EmailMessage): Promise<void> {
      const response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'api-key': config.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: { email: config.fromAddress, name: config.fromName },
          to: message.to.map((email) => ({ email })),
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
        }),
        signal: AbortSignal.timeout(10_000),
      })
      if (response.status === 201) return

      const body = (await response.json().catch(() => ({}))) as BrevoErrorBody
      throw new ProviderError(body.code ?? response.status, response.status)
    },
  }
}
