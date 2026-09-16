const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

export interface TurnstileVerifyParams {
  token: string
  remoteIp: string
  /** ADR 0012 §4: the client's submissionId — a Turnstile token is single-use. */
  idempotencyKey: string
}

interface SiteverifyResponse {
  success?: boolean
}

/**
 * ADR 0003 §4 / ADR 0012 §4: server-side Turnstile verification. Fails
 * closed — a missing secret (misconfigured env) or a network error is
 * treated as "not verified", never as "verified".
 */
export async function verifyTurnstile(params: TurnstileVerifyParams): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) return false

  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret,
        response: params.token,
        remoteip: params.remoteIp,
        idempotency_key: params.idempotencyKey,
      }),
    })
    if (!response.ok) return false
    const data = (await response.json()) as SiteverifyResponse
    return data.success === true
  } catch {
    return false
  }
}
