import { normalizeGeorgianPhone } from '../../shared/contract/phone'
import { ProviderError } from './errors'
import type { SmsMessage, SmsSender } from './types'

export interface SendergeConfig {
  apiKey: string
}

interface SendergeResponseBody {
  statusId?: number
}

// ADR 0019: fallback SMS provider. One request per number (its API takes a
// single destination), `smsno=2` (informational, no "SMS NO" opt-out
// footer). `destination` is the 9-digit national number, no `+995`.
// Success is HTTP 200 with `statusId === 1`.
export function createSendergeSmsSender(config: SendergeConfig): SmsSender {
  return {
    async send(message: SmsMessage): Promise<void> {
      for (const raw of message.to) {
        const normalized = normalizeGeorgianPhone(raw)
        if (!normalized) throw new ProviderError('invalid_recipient')
        const destination = normalized.replace('+995', '')

        const body = new URLSearchParams({
          apikey: config.apiKey,
          destination,
          content: message.text,
          smsno: '2',
        })

        const response = await fetch('https://sender.ge/api/send.php', {
          method: 'POST',
          body,
          signal: AbortSignal.timeout(10_000),
        })

        if (!response.ok) throw new ProviderError(response.status, response.status)

        const result = (await response.json().catch(() => ({}))) as SendergeResponseBody
        if (result.statusId !== 1) throw new ProviderError(result.statusId ?? response.status, response.status)
      }
    },
  }
}
