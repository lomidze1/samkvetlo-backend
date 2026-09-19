import { Forbidden, getFieldsToSign, jwtSign, type CollectionBeforeOperationHook, type CollectionRefreshHook } from 'payload'
import { sql } from '@payloadcms/db-postgres'

import type { User } from '../../payload-types'
import { SESSION_MAX_AGE_S } from '../../server/security/sessions'

// See revokeOnPasswordChange.ts's WithSid comment — `_sid` isn't part of
// any exported Payload type.
interface WithSid {
  _sid?: string
}

/** Shared by enforceSessionMaxAge and clampRefreshExpiry below — the one
 * place both need `users_sessions.created_at` for the current sid. */
async function getSessionCreatedAt(
  req: { payload: { db: unknown } },
  sid: string,
  userId: number | string,
): Promise<Date | undefined> {
  const drizzle = (req.payload.db as unknown as { drizzle: { execute: (query: unknown) => Promise<{ rows: unknown[] }> } })
    .drizzle
  const result = await drizzle.execute(
    sql`SELECT "created_at" FROM "users_sessions" WHERE "id" = ${sid} AND "_parent_id" = ${userId} LIMIT 1`,
  )
  const row = result.rows[0] as { created_at: string } | undefined
  return row ? new Date(row.created_at) : undefined
}

/**
 * ADR 0018 addendum A (T5.17a): a 12 h absolute session cap, independent of
 * `tokenExpiration`'s rolling refresh window — without this, refreshing
 * before each 2 h token expires kept a session alive forever. Runs on
 * `beforeOperation` (registered for every operation on the collection, so
 * this only acts on `refresh`) — Payload's own refresh operation calls this
 * *before* it reads/renews the session itself (refresh.js), so it can
 * reject before that ever happens.
 *
 * Queried directly against `users_sessions` (same drizzle-via-adapter
 * pattern as requireTotp.ts, since Payload's Local API has no "read one
 * session row" helper) rather than trusting `req.user.sessions` from the
 * JWT payload, which never carries a `createdAt`.
 */
export const enforceSessionMaxAge: CollectionBeforeOperationHook<'users'> = async ({ args, operation }) => {
  if (operation !== 'refresh') return args

  const { req } = args
  const sid = (req.user as WithSid | null)?._sid
  if (!req.user || !sid) throw new Forbidden(req.t)

  const createdAt = await getSessionCreatedAt(req, sid, req.user.id)
  if (!createdAt) throw new Forbidden(req.t)

  const ageSeconds = (Date.now() - createdAt.getTime()) / 1000
  if (ageSeconds >= SESSION_MAX_AGE_S) throw new Forbidden(req.t)

  return args
}

/**
 * Code review finding: enforceSessionMaxAge above only rejects a refresh
 * *after* the 12 h mark — a refresh just before it still got Payload's
 * default full `tokenExpiration` (2 h) grant, so a token issued at, say,
 * 11h59m of session age stayed valid (by its own `exp` claim, which is all
 * `JWTAuthentication` checks for a non-refresh request — it never looks at
 * `users_sessions.expires_at`) until 13h59m — the true max was 12 h + one
 * last 2 h token, not 12 h.
 *
 * Payload's `refresh` collection hooks (unlike `beforeOperation`/
 * `afterOperation`) can fully replace the default result: if this returns a
 * value, `refreshOperation` uses it as-is instead of its own `jwtSign` call
 * (refresh.js). That's what lets this shorten *only* the JWT/cookie expiry
 * for the token this refresh hands back — clamped to whatever's left until
 * createdAt + 12 h — without touching `enforceSessionMaxAge`'s own
 * createdAt-based cutoff (still the actual enforcement for the *next*
 * refresh attempt) or introducing a second source of truth for it.
 *
 * The `users_sessions.expires_at` row Payload bumps by the *unclamped*
 * tokenExpiration right before calling this hook is left as-is — nothing
 * ever reads it for authorization (confirmed against
 * `dist/auth/strategies/jwt.js`; it exists only for admin visibility /
 * eventual pruning), so a stale value there doesn't reopen the gap this
 * closes.
 */
export const clampRefreshExpiry: CollectionRefreshHook<User> = async ({ args, user }) => {
  const { collection, req } = args
  const sid = (req.user as WithSid | null)?._sid
  if (!req.user || !sid) throw new Forbidden(req.t)

  const createdAt = await getSessionCreatedAt(req, sid, req.user.id)
  if (!createdAt) throw new Forbidden(req.t)

  const remainingS = SESSION_MAX_AGE_S - Math.floor((Date.now() - createdAt.getTime()) / 1000)
  if (remainingS <= 0) throw new Forbidden(req.t)

  const tokenExpiration = collection.config.auth.tokenExpiration ?? 7200
  // Within budget for a full grant — let Payload's own default jwtSign run
  // (returning nothing here means "no override", per RefreshHook's type).
  if (remainingS >= tokenExpiration) return

  const fieldsToSign = getFieldsToSign({ collectionConfig: collection.config, email: user?.email, sid, user: req.user })
  const { exp, token } = await jwtSign({ fieldsToSign, secret: req.payload.secret, tokenExpiration: remainingS })

  return { exp, refreshedToken: token, setCookie: true, strategy: (req.user as { _strategy?: string })._strategy, user }
}
