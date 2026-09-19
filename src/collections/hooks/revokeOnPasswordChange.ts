import type { CollectionAfterChangeHook, CollectionBeforeValidateHook } from 'payload'

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
