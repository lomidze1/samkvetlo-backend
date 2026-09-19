import { Forbidden, type CollectionBeforeOperationHook } from 'payload'
import { sql } from '@payloadcms/db-postgres'

import { SESSION_MAX_AGE_S } from '../../server/security/sessions'

// See revokeOnPasswordChange.ts's WithSid comment — `_sid` isn't part of
// any exported Payload type.
interface WithSid {
  _sid?: string
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

  const drizzle = (req.payload.db as unknown as { drizzle: { execute: (query: unknown) => Promise<{ rows: unknown[] }> } })
    .drizzle
  const result = await drizzle.execute(
    sql`SELECT "created_at" FROM "users_sessions" WHERE "id" = ${sid} AND "_parent_id" = ${req.user.id} LIMIT 1`,
  )
  const row = result.rows[0] as { created_at: string } | undefined
  if (!row) throw new Forbidden(req.t)

  const ageSeconds = (Date.now() - new Date(row.created_at).getTime()) / 1000
  if (ageSeconds >= SESSION_MAX_AGE_S) throw new Forbidden(req.t)

  return args
}
