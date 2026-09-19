import type { CollectionBeforeOperationHook } from 'payload'
import { sql } from '@payloadcms/db-postgres'

const THROTTLE_WINDOW_MS_SQL = "interval '15 minutes'"
const THROTTLE_MAX_ATTEMPTS = 5

export const TOTP_RESERVATION_CONTEXT_KEY = 'totpReservation'

export interface TotpReservation {
  userId: number | string
  /** Whether this attempt is within budget (<= 5 in the current 15 min window). */
  allowed: boolean
}

/**
 * Code review finding on requireTotp.ts: the throttle used to *decide*
 * whether an attempt is allowed by reading `totpFailCount`/
 * `totpFailWindowStart` off the `user` row handed to the `beforeLogin` hook
 * — a plain `SELECT`, taken with no lock. Concurrent requests for the same
 * user could each read the count *before* any of their own increments
 * landed, so a flood of simultaneous guesses could all slip past the
 * 5-attempt gate even though the increments themselves (an atomic
 * `UPDATE ... SET count = CASE ... END`, see requireTotp.ts) never lose one
 * another.
 *
 * Closing that requires the reservation to be both (a) atomic — a single
 * `UPDATE ... RETURNING` — and (b) *awaited*, so the decision this request
 * makes is based on its own post-increment count, not a stale pre-increment
 * read. Both together rule out doing this from `beforeLogin`
 * (requireTotp.ts): by the time `beforeLogin` hooks run, Payload's own
 * `addSessionToUser`/`resetLoginAttempts` have already written to this same
 * `users` row *inside req's still-open transaction*, so that row's lock is
 * already held for the rest of this request. Any other write to that row —
 * on `req`'s own connection, since `req`'s eventual failure path
 * (`requireTotp` always ends by throwing) rolls back everything written
 * with `req`; or on a separate connection, since awaiting a write blocked
 * on a lock `req`'s own (single-threaded, still-running) hook is what would
 * eventually release is a genuine deadlock, reproduced against real
 * Postgres — see requireTotp.ts's `recordFailure` comment. Either way, the
 * `users` row is off the table once `beforeLogin` runs.
 *
 * `beforeOperation` (this hook, `operation: 'login'` only — `resetPassword`
 * gets its own `beforeOperation` call with `operation: 'resetPassword'`,
 * which this ignores) runs *before any of that* — first thing in
 * `loginOperation`, before the password check, before `initTransaction`.
 * No transaction is open yet, so this `UPDATE ... RETURNING`, awaited on
 * `req`'s own (still transaction-free) connection, neither blocks on nor
 * gets rolled back by anything downstream. It reserves the attempt by
 * email (the only identifier available this early — Payload hasn't looked
 * up the user yet either) and stashes the outcome on `req.context` for
 * requireTotp.ts to read.
 *
 * Trade-off, accepted: this reserves (and can throttle) on every login
 * attempt for an enrolled user, including ones that fail on a *wrong
 * password* and never reach the TOTP prompt at all — there is no hook
 * point between "password confirmed correct" and "the users row is
 * locked" to reserve later instead. Payload's own `maxLoginAttempts`
 * lockout (5 wrong passwords -> 15 min lock, independent of this counter)
 * already bounds repeated wrong-password attempts, so this only makes a
 * genuine brute force *more* conservative, never less — worst case, a
 * partner who mistypes their password a few times has fewer of their 5
 * TOTP tries left once they get the password right, within the same
 * 15-minute window a wrong password would largely exhaust anyway.
 */
export const reserveTotpAttempt: CollectionBeforeOperationHook<'users'> = async ({ args, operation, req }) => {
  if (operation !== 'login') return args

  const email = typeof args.data?.email === 'string' ? args.data.email.toLowerCase().trim() : ''
  if (!email) return args

  // Bound as a parameter (Node's clock, not Postgres's own `now()`) so this
  // agrees with `verifyTotp`'s window (also Node-clock-based) and so tests
  // can fake time (vi.useFakeTimers only fakes this process's Date, not a
  // separate DB server's clock) — in production the two clocks are the
  // same real wall time regardless.
  const now = new Date().toISOString()

  const drizzle = (req.payload.db as unknown as { drizzle: { execute: (query: unknown) => Promise<{ rows: unknown[] }> } })
    .drizzle
  const result = await drizzle.execute(
    sql`
      UPDATE "users"
      SET
        "totp_fail_count" = CASE
          WHEN "totp_fail_window_start" IS NOT NULL AND ${now}::timestamptz - "totp_fail_window_start" < ${sql.raw(THROTTLE_WINDOW_MS_SQL)}
            THEN COALESCE("totp_fail_count", 0) + 1
          ELSE 1
        END,
        "totp_fail_window_start" = CASE
          WHEN "totp_fail_window_start" IS NOT NULL AND ${now}::timestamptz - "totp_fail_window_start" < ${sql.raw(THROTTLE_WINDOW_MS_SQL)}
            THEN "totp_fail_window_start"
          ELSE ${now}::timestamptz
        END
      WHERE lower("email") = ${email}
      RETURNING "id", "totp_fail_count"
    `,
  )

  const row = result.rows[0] as { id: number | string; totp_fail_count: number } | undefined
  if (!row) return args

  const reservation: TotpReservation = { userId: row.id, allowed: row.totp_fail_count <= THROTTLE_MAX_ATTEMPTS }
  req.context[TOTP_RESERVATION_CONTEXT_KEY] = reservation

  return args
}
