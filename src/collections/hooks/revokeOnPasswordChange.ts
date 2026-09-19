import type { CollectionAfterChangeHook, CollectionAfterOperationHook, CollectionBeforeValidateHook } from 'payload'

import { revokeUserSessions } from '../../server/security/sessions'

const CONTEXT_FLAG = 'passwordChanged'

// `_sid` (the current session's id) is set at runtime by Payload's JWT auth
// strategy onto `req.user` (see e.g. refresh.js, which reads the very same
// `args.req.user._sid`) but isn't part of any exported type — TypedUser
// only ever adds `_strategy`/`collection` beyond the generated User shape.
interface WithSid {
  _sid?: string
}

/**
 * ADR 0018 addendum A (T5.17a): flags a genuine password change (`update`
 * with a `password` in the request body — Payload only runs its password
 * hashing when the field is actually present) via `req.context`, read back
 * by `revokeSessionsOnPasswordChange` below in the same request.
 */
export const flagPasswordChange: CollectionBeforeValidateHook = ({ data, operation, context }) => {
  if (operation === 'update' && typeof data?.password === 'string') {
    context[CONTEXT_FLAG] = true
  }
  return data
}

/**
 * Revokes every session for the account whose password just changed —
 * except, when the caller changed their *own* password, their own current
 * session (so they aren't immediately logged out by the action that just
 * confirmed they know the new password). Runs with `req` (same still-open
 * transaction as the password write itself — a *different* connection
 * updating this same, already-locked row here would deadlock, same as
 * requireTotp.ts's audit write has to avoid the opposite way).
 */
export const revokeSessionsOnPasswordChange: CollectionAfterChangeHook = async ({ doc, req, context }) => {
  if (!context[CONTEXT_FLAG]) return doc

  const keepSid = req.user?.id === doc.id ? (req.user as WithSid)._sid : undefined
  const revokedCount = await revokeUserSessions({ payload: req.payload, userId: doc.id, req, keepSid })
  if (revokedCount > 0) {
    req.payload.logger.info({ userId: doc.id, revokedCount }, 'revokeSessionsOnPasswordChange: revoked')
  }
  return doc
}

/**
 * Code review finding: the public "forgot password" flow (`POST
 * /api/users/reset-password`, token from an emailed link) writes the new
 * hash/salt via `payload.db.updateOne` — a direct db-adapter call, not the
 * `update` operation — so `beforeValidate`/`afterChange` (flagPasswordChange
 * / revokeSessionsOnPasswordChange above) never run for it (verified
 * against payload@3.89.0 `dist/auth/operations/resetPassword.js`). Today
 * this path always 401s anyway — `Users.hooks.beforeLogin: [requireTotp]`
 * also runs inside `resetPasswordOperation` (it calls the same beforeLogin
 * chain as login) and unconditionally rejects because the reset request has
 * no `totp` field (ADR 0018 §2; proven by
 * tests/int/totp.int.spec.ts's "(6) reset-password without a code" case,
 * whose rejection rolls back the *entire* transaction — including the
 * password write — since `resetPasswordOperation`'s single try/catch calls
 * `killTransaction` on any thrown error). So there is no live path today
 * where a password reset actually persists without also revoking sessions
 * by other means. This hook closes the gap anyway, in case that ever
 * changes (a future reset UI that also collects a TOTP code, or a direct
 * REST call that supplies one) rather than relying on that being
 * incidental.
 *
 * `afterOperation` is the right hook point here — unlike `afterChange`, it
 * *does* run for `resetPassword` (`resetPassword.js` calls
 * `buildAfterOperation({ operation: 'resetPassword', ... })` explicitly,
 * with `result: { token, user }`), and it runs *after* `commitTransaction`,
 * so there's no risk of the deadlock documented in requireTotp.ts (a
 * separate-connection write awaited while `req`'s own transaction still
 * holds the users row's lock) — by this point `req.transactionID` has
 * already been deleted, so `revokeUserSessions`'s `payload.db.updateOne`
 * call just runs as a normal, immediately-committed statement.
 *
 * The reset itself creates one new session (`addSessionToUser`, before
 * beforeLogin runs) and returns its JWT in `result.token` — decoding that
 * (no verification needed; it's the token this same request just signed)
 * lets this keep *that* session, mirroring revokeSessionsOnPasswordChange's
 * "keep the actor's own session" rule above, instead of logging the person
 * who just reset their own password straight back out.
 */
export const revokeSessionsOnPasswordReset: CollectionAfterOperationHook<'users'> = async ({ operation, req, result }) => {
  if (operation !== 'resetPassword') return result

  const { user, token } = result as { token?: string; user?: { id: number | string } }
  if (!user?.id) return result

  const keepSid = typeof token === 'string' ? decodeJwtSid(token) : undefined
  const revokedCount = await revokeUserSessions({ payload: req.payload, userId: user.id, req, keepSid })
  if (revokedCount > 0) {
    req.payload.logger.info({ userId: user.id, revokedCount }, 'revokeSessionsOnPasswordReset: revoked')
  }
  return result
}

/** Best-effort, unverified decode of a just-signed JWT's `sid` claim — see
 * revokeSessionsOnPasswordReset's comment. Never used for authentication,
 * only to pick which existing session to keep; any failure here just means
 * every session (including the brand new one) gets revoked instead, which
 * is still safe. */
function decodeJwtSid(token: string): string | undefined {
  try {
    const payloadSegment = token.split('.')[1]
    if (!payloadSegment) return undefined
    const claims = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as { sid?: unknown }
    return typeof claims.sid === 'string' ? claims.sid : undefined
  } catch {
    return undefined
  }
}
