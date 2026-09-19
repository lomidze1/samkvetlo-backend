import type { Payload, PayloadRequest } from 'payload'

// ADR 0018 addendum A (T5.17a): server-side session revocation.
// `useSessions: true` (Users.ts, Payload's own default) already writes one
// row per login/refresh into the `users_sessions` child table (id /
// _parent_id / created_at / expires_at — present since the very first
// migration, 20260915_133239) — nothing has ever deleted a row from it.
// This is the fix: an explicit revoke, called on TOTP enroll/rotate and on
// a password change, plus the 12 h absolute session cap enforced below on
// every refresh.

/** Absolute session lifetime, independent of `tokenExpiration`'s rolling refresh window. */
export const SESSION_MAX_AGE_S = 43200

interface RevokeUserSessionsArgs {
  payload: Payload
  userId: number | string
  req?: PayloadRequest
  /** Keep this one session (e.g. the caller's own, right after they changed their own password). */
  keepSid?: string
}

/**
 * Revokes all (or all but `keepSid`) of a user's sessions by rewriting the
 * `sessions` array via `payload.db.updateOne` — the same primitive Payload's
 * own refresh operation uses to prune expired sessions (refresh.js), so
 * this is a supported, not a workaround. Returns how many sessions were
 * actually removed.
 */
export async function revokeUserSessions({
  payload,
  userId,
  req,
  keepSid,
}: RevokeUserSessionsArgs): Promise<number> {
  const user = await payload.findByID({
    collection: 'users',
    id: userId,
    req,
    overrideAccess: true,
    depth: 0,
  })
  const sessions = (user.sessions ?? []) as { id: string }[]
  const kept = keepSid ? sessions.filter((session) => session.id === keepSid) : []
  const revokedCount = sessions.length - kept.length
  if (revokedCount === 0) return 0

  await payload.db.updateOne({
    collection: 'users',
    id: userId,
    data: { sessions: kept },
    req,
    returning: false,
  })

  return revokedCount
}
