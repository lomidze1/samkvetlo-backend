import { APIError, type CollectionBeforeLoginHook } from 'payload'
import { sql } from '@payloadcms/db-postgres'

import type { User } from '../../payload-types'
import { ka } from '../../i18n/ka'
import { TOTP_RESERVATION_CONTEXT_KEY, type TotpReservation } from './reserveTotpAttempt'
import { buildOtpauthUri, deriveEnrollmentSecret, verifyTotp } from '../../server/security/totp'

/**
 * ADR 0018 addendum C: the first-login QR response. Its own class so that
 * payload.config's `loggingLevels` logs it at `info` (message only) — at the
 * default `error` level Payload's logError prints `data`, i.e. the secret.
 */
export class TotpEnrollmentRequired extends APIError {
  constructor(data: { otpauthUri: string; secret: string }) {
    super(ka.server.security.totp.enrollmentRequired, 403, data, true)
    this.name = 'TotpEnrollmentRequired'
  }
}

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
export const requireTotp: CollectionBeforeLoginHook<User> = async ({ context, req, user }) => {
  const code = req.data?.totp

  // Code review finding: reserveTotpAttempt.ts (Users.hooks.beforeOperation,
  // `operation: 'login'`) already reserved this attempt — atomically, before
  // any transaction opened on this row — and recorded on `req.context`
  // whether it's within budget. See that file's comment for why the
  // reservation has to happen there and not here, and why it's `login`-only:
  // `resetPasswordOperation` calls `beforeOperation` *after* its own
  // `initTransaction`, so the same "reserve before any lock exists" trick
  // doesn't apply to it the same way. `requireTotp` also runs inside
  // `resetPassword` (and `registerFirstUser`, which never reaches here with
  // a totpSecret at all) — for those, `reservation` stays `undefined` and
  // the block below falls back to this hook's *previous* behaviour (a
  // stale, unlocked read plus a best-effort fire-and-forget increment):
  // still racy under true concurrency, exactly as it was before this fix,
  // not a regression — just not the part of the race this fix closes,
  // since `resetPassword` already requires a valid, single-use emailed
  // token to even reach here (ADR 0018 §2's "reset without a code is fully
  // blocked" note; see tests/int/totp.int.spec.ts "(6)").
  const reservation =
    context[TOTP_RESERVATION_CONTEXT_KEY] as TotpReservation | undefined
  const hasReservation = reservation?.userId === user.id

  const windowStart = user.totpFailWindowStart ? new Date(user.totpFailWindowStart) : null
  const windowActive = windowStart !== null && Date.now() - windowStart.getTime() < 15 * 60 * 1000
  const staleFailCount = windowActive ? (user.totpFailCount ?? 0) : 0

  const alreadyThrottled = hasReservation ? !reservation.allowed : staleFailCount >= THROTTLE_MAX_FAILURES

  const recordFailure = async (reason: string): Promise<never> => {
    if (!hasReservation) {
      // Fallback path only (see above) — the original atomic-but-racy
      // increment, on a separate connection and *not* awaited: `req`'s own
      // transaction rolls back everything written with `req` the moment
      // this hook throws (confirmed: an earlier version used `req` and the
      // counter silently stayed at 0 forever), and a separate connection's
      // write to this same, already-locked-by-`req` row would deadlock if
      // awaited (`addSessionToUser`/`resetLoginAttempts` already hold the
      // lock by the time `beforeLogin` runs) — reproduced against real
      // Postgres, same as the audit-events write below.
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
    }

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
    // write (and the counter UPDATE above, on the fallback path) is queued
    // behind, and both complete right after — a genuine deadlock
    // otherwise, confirmed by a minimal repro against Postgres, not just a
    // theoretical concern. This write is informational only (admin
    // visibility) — never the throttle's source of truth.
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

  // Already throttled: reject without recording this one again (the
  // reservation, when there is one, already counted it atomically; on the
  // fallback path this preserves the original "leave the window's start
  // time alone" behaviour).
  if (alreadyThrottled) {
    req.payload.logger.info({ userId: user.id, reason: 'throttled' }, 'requireTotp: rejected')
    throw new APIError(ka.server.security.totp.invalidCode, 401)
  }

  // ADR 0018 addendum C: first-login enrollment. Only an account with no
  // secret and an open window (set on create / by a Super Admin's reset)
  // qualifies; anything else stays fail-closed below. This hook runs after
  // Payload has checked the password, so the QR is only ever handed to
  // someone who knows it.
  const openUntil = user.enrollmentOpenUntil ?? null
  const enrollmentSecret =
    !user.totpSecret && openUntil && new Date(openUntil).getTime() > Date.now()
      ? deriveEnrollmentSecret(req.payload.secret, user.id, openUntil)
      : null

  if (req.data?.enroll === true) {
    if (!enrollmentSecret) return recordFailure('enrollment-not-open')
    req.payload.logger.info({ userId: user.id }, 'requireTotp: enrollment QR issued')
    throw new TotpEnrollmentRequired({
      otpauthUri: buildOtpauthUri(enrollmentSecret, user.email),
      secret: enrollmentSecret,
    })
  }

  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return recordFailure('missing-or-malformed-code')
  }

  // Fail closed (ADR 0018 §2.2): a user with no secret can never log in,
  // regardless of code — this is exactly the T5.9 spike's (c) hole —
  // unless they are completing enrollment with the QR's code.
  const secret = user.totpSecret ?? enrollmentSecret
  if (!secret) {
    return recordFailure('no-totp-secret')
  }

  const result = verifyTotp({ secret, code, lastStep: user.totpSecret ? user.totpLastStep : null })
  if (!result.ok) {
    return recordFailure('invalid-or-replayed-code')
  }

  // Success: persist the new lastStep and reset the failure counter inside
  // the login transaction (`req`) — plain field updates, not the
  // audit-events/counter writes the deadlock risk above is about (this one
  // never throws afterward, so it isn't rolled back). On enrollment the
  // derived secret becomes the stored one and the window closes.
  const enrolled = !user.totpSecret
  await req.payload.update({
    collection: 'users',
    id: user.id,
    data: {
      totpLastStep: result.step,
      totpFailCount: 0,
      totpFailWindowStart: null,
      ...(enrolled ? { totpSecret: secret, totpEnabledAt: new Date().toISOString(), enrollmentOpenUntil: null } : {}),
    },
    overrideAccess: true,
    req,
  })
  if (enrolled) req.payload.logger.info({ userId: user.id }, 'requireTotp: enrolled on first login')

  return user
}
