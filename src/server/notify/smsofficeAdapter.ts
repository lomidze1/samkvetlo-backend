import { normalizeGeorgianPhone } from '../../shared/contract/phone'
import { ProviderError } from './errors'
import type { SmsMessage, SmsSender } from './types'

export interface SmsofficeConfig {
  apiKey: string
  sender: string
}

interface SmsofficeResponseBody {
  ErrorCode?: number
  Success?: boolean
}

// ADR 0019: primary SMS provider. All recipients go in one request
// (comma-separated `destination`), `urgent=true` (transactional, needs an
// approved sender). `key` is in the form body, never the URL, so it never
// lands in a request log. Success is `Success === true && ErrorCode === 0`
// regardless of the HTTP status.
export function createSmsofficeSmsSender(config: SmsofficeConfig): SmsSender {
  return {
    async send(message: SmsMessage): Promise<void> {
      const destinations = message.to.map((raw) => {
        const normalized = normalizeGeorgianPhone(raw)
        if (!normalized) throw new ProviderError('invalid_recipient')
        return normalized.replace('+', '')
      })

      const body = new URLSearchParams({
        key: config.apiKey,
        destination: destinations.join(','),
        sender: config.sender,
        content: message.text,
        urgent: 'true',
      })

      const response = await fetch('https://smsoffice.ge/api/v2/send/', {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(10_000),
      })

      const result = (await response.json().catch(() => ({}))) as SmsofficeResponseBody
      if (result.Success === true && result.ErrorCode === 0) return
      throw new ProviderError(result.ErrorCode ?? response.status, response.status)
    },
  }
}
