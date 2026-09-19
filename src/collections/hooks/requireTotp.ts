import { APIError, type CollectionBeforeLoginHook } from 'payload'

import type { User } from '../../payload-types'
import { ka } from '../../i18n/ka'
import { verifyTotp } from '../../server/security/totp'

const THROTTLE_WINDOW_MS = 15 * 60 * 1000
const THROTTLE_MAX_FAILURES = 5

/**
 * ADR 0018 §2: the login gate that closes the T5.9 spike hole. Runs in the
 * *same* request as the password (no "half-logged-in" session), inside
 * Payload's login transaction (see login.js: beforeLogin runs after the
 * transaction opens and before jwtSign; a thrown error here reaches the
 * `catch` that calls killTransaction — no token, no cookie, ever).
 *
 * `req.data` (not the `data` passed to loginOperation, which only ever
 * carries email/password/username) is the full REST body, so the `totp`
 * field the custom login view submits is only readable from there.
 *
 * Every rejection — bad shape, no secret, throttled, wrong/expired,
 * replayed — throws the exact same Georgian message. The *reason* is only
 * ever visible in the server log, via the 401's cause.
 */
export const requireTotp: CollectionBeforeLoginHook<User> = async ({ req, user }) => {
  const code = req.data?.totp
  const failClosed = (reason: string): never => {
    // Written with the shared `payload` instance, *no* `req`, and — this
    // is the part the ADR's "outside the transaction" note didn't spell
    // out, found by reproducing it against real Postgres — *not awaited*.
    // audit-events.user is a real FK to users.id, and by this point the
    // still-open login transaction has already written to that exact
    // users row (addSessionToUser/resetLoginAttempts, both before
    // beforeLogin runs). Postgres's FK check on the INSERT needs a
    // row-level lock on that referenced row, so if this call were
    // `await`ed here, it would block until the login's own transaction
    // ends — and it can't end until this hook returns. Firing it without
    // awaiting lets this hook throw immediately; loginOperation's catch
    // block then does revokeSession + killTransaction (using the
    // *original* req/transaction, so that part never touches this new
    // transaction's lock wait), which releases the users-row lock this
    // write is queued behind, and it completes right after — a genuine
    // deadlock otherwise, confirmed by a minimal repro against Postgres,
    // not just a theoretical concern.
    req.payload
      .create({
        collection: 'audit-events',
        data: {
          type: 'login.totp-failed',
          user: user.id,
          country: req.headers.get('x-vercel-ip-country') ?? '',
          at: new Date().toISOString(),
        },
        overrideAccess: true,
      })
      .catch((error: unknown) => {
        req.payload.logger.error(error, 'requireTotp: failed to write login.totp-failed audit event')
      })
    req.payload.logger.info({ userId: user.id, reason }, 'requireTotp: rejected')
    throw new APIError(ka.server.security.totp.invalidCode, 401)
  }

  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return failClosed('missing-or-malformed-code')
  }

  // Fail closed (ADR 0018 §2.2): a user with no secret can never log in,
  // regardless of code — this is exactly the T5.9 spike's (c) hole.
  const secret = user.totpSecret
  if (!secret) {
    return failClosed('no-totp-secret')
  }

  const since = new Date(Date.now() - THROTTLE_WINDOW_MS).toISOString()
  const { totalDocs: recentFailures } = await req.payload.count({
    collection: 'audit-events',
    where: {
      and: [{ type: { equals: 'login.totp-failed' } }, { user: { equals: user.id } }, { at: { greater_than: since } }],
    },
    overrideAccess: true,
  })
  if (recentFailures >= THROTTLE_MAX_FAILURES) {
    return failClosed('throttled')
  }

  const result = verifyTotp({ secret, code, lastStep: user.totpLastStep })
  if (!result.ok) {
    return failClosed('invalid-or-replayed-code')
  }

  // Success: persist the new lastStep inside the login transaction (`req`)
  // — this is a plain field update, not the audit-events table the
  // deadlock risk is about.
  await req.payload.update({
    collection: 'users',
    id: user.id,
    data: { totpLastStep: result.step },
    overrideAccess: true,
    req,
  })

  return user
}
