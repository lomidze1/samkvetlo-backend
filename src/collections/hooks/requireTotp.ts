import { APIError, type CollectionBeforeLoginHook } from 'payload'
import { sql } from '@payloadcms/db-postgres'

import type { User } from '../../payload-types'
import { ka } from '../../i18n/ka'
import { verifyTotp } from '../../server/security/totp'

const THROTTLE_WINDOW_MS_SQL = "interval '15 minutes'"
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

  const windowStart = user.totpFailWindowStart ? new Date(user.totpFailWindowStart) : null
  const windowActive = windowStart !== null && Date.now() - windowStart.getTime() < 15 * 60 * 1000
  const failCountBeforeThisAttempt = windowActive ? (user.totpFailCount ?? 0) : 0

  const recordFailure = async (reason: string): Promise<never> => {
    // Code review finding: this *must* run outside req's transaction, on a
    // separate connection, same as the audit-events insert below and for
    // the same reason (see that write's comment) — killTransaction rolls
    // back everything written with `req` the moment this hook throws, so a
    // `req`-scoped update here would never actually persist (confirmed:
    // the first version of this fix used `req` and the counter silently
    // stayed at 0 forever). It also can't be *awaited*: a separate
    // connection's UPDATE against this same users row would queue behind
    // the row lock addSessionToUser/resetLoginAttempts already hold in the
    // still-open transaction, and awaiting it here would deadlock exactly
    // like an awaited audit-events insert would.
    //
    // So: fire-and-forget, like the audit-events insert — but the
    // increment itself is a single atomic `UPDATE ... SET count = count +
    // 1` (computed entirely in SQL, including the window check against
    // `now()`), not a JS read-modify-write. That makes concurrent
    // increments for the same user never lose one another (each UPDATE
    // fully serializes against the row, whichever order they land in) —
    // the one race this can't close is the *decision* a given request
    // makes from the `user` row it was handed at the very start (a plain
    // SELECT, no lock): a flood of truly simultaneous requests can each
    // still see the same pre-increment count before any of their own
    // writes land. Payload's own maxLoginAttempts lockout (5 wrong
    // *passwords* -> 15 min lock, Users.ts) bounds that further, since
    // reaching this hook at all requires the correct password.
    // payload's DatabaseAdapter type doesn't expose the underlying drizzle
    // instance (that's specific to the Postgres adapter) — this mirrors
    // exactly what a migration's { db } destructure already is (see
    // src/migrations/*.ts), just reached via the adapter Payload wires up.
    const drizzle = (req.payload.db as unknown as { drizzle: { execute: (query: unknown) => Promise<unknown> } }).drizzle
    drizzle
      .execute(
        sql`
          UPDATE "users"
          SET
            "totp_fail_count" = CASE
              WHEN "totp_fail_window_start" IS NOT NULL AND now() - "totp_fail_window_start" < ${sql.raw(THROTTLE_WINDOW_MS_SQL)}
                THEN COALESCE("totp_fail_count", 0) + 1
              ELSE 1
            END,
            "totp_fail_window_start" = CASE
              WHEN "totp_fail_window_start" IS NOT NULL AND now() - "totp_fail_window_start" < ${sql.raw(THROTTLE_WINDOW_MS_SQL)}
                THEN "totp_fail_window_start"
              ELSE now()
            END
          WHERE "id" = ${user.id}
        `,
      )
      .catch((error: unknown) => {
        req.payload.logger.error(error, 'requireTotp: failed to record a totp failure')
      })

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
    // write (and the counter UPDATE above) is queued behind, and both
    // complete right after — a genuine deadlock otherwise, confirmed by a
    // minimal repro against Postgres, not just a theoretical concern. This
    // write is informational only (admin visibility) — never the
    // throttle's source of truth.
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

  // Already throttled: reject without touching the row again (leaves the
  // window's start time — and therefore its expiry — alone).
  if (failCountBeforeThisAttempt >= THROTTLE_MAX_FAILURES) {
    req.payload.logger.info({ userId: user.id, reason: 'throttled' }, 'requireTotp: rejected')
    throw new APIError(ka.server.security.totp.invalidCode, 401)
  }

  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return recordFailure('missing-or-malformed-code')
  }

  // Fail closed (ADR 0018 §2.2): a user with no secret can never log in,
  // regardless of code — this is exactly the T5.9 spike's (c) hole.
  const secret = user.totpSecret
  if (!secret) {
    return recordFailure('no-totp-secret')
  }

  const result = verifyTotp({ secret, code, lastStep: user.totpLastStep })
  if (!result.ok) {
    return recordFailure('invalid-or-replayed-code')
  }

  // Success: persist the new lastStep and reset the failure counter inside
  // the login transaction (`req`) — plain field updates, not the
  // audit-events/counter writes the deadlock risk above is about (this one
  // never throws afterward, so it isn't rolled back).
  await req.payload.update({
    collection: 'users',
    id: user.id,
    data: { totpLastStep: result.step, totpFailCount: 0, totpFailWindowStart: null },
    overrideAccess: true,
    req,
  })

  return user
}
