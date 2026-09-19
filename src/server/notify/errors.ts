// ADR 0019 §4-§6: thrown by getEmailSender()/getSmsSender() (not-configured
// / missing-config) and by an adapter's send() (a provider rejected the
// request). Neither error's `message` ever contains a key, request body, or
// recipient — sendAndReport forwards only `name`/`code` to Sentry, and a
// message containing PII would defeat that (ADR 0014 §11).

/**
 * The selected adapter (or the lack of one) cannot send at all:
 * - 'not_configured': EMAIL_ADAPTER/SMS_ADAPTER is unset in production.
 * - 'missing_config': the selected adapter is missing its API key/from
 *   address, or the env value names an adapter that does not exist.
 */
export class NotifyConfigError extends Error {
  readonly code: 'missing_config' | 'not_configured'

  constructor(code: 'missing_config' | 'not_configured') {
    super(`notify config error: ${code}`)
    this.name = 'NotifyConfigError'
    this.code = code
  }
}

/**
 * A provider rejected the request (bad request, quota, auth, invalid
 * recipient...). `code` is the provider's own error identifier (Resend
 * `name`, Brevo `code`, smsoffice `ErrorCode`, sender.ge HTTP/`statusId`) —
 * never the provider's free-text message, which routinely echoes back the
 * recipient address.
 */
export class ProviderError extends Error {
  readonly code: number | string
  readonly status?: number

  constructor(code: number | string, status?: number) {
    super(`provider error: ${code}`)
    this.name = 'ProviderError'
    this.code = code
    this.status = status
  }
}
