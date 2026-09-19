import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// ADR 0018 addendum A (T5.17a): a data migration, not a schema one — the
// schema diff here is empty (this .json snapshot is identical to the
// previous migration's, aside from its own random id/prevId chaining).
// `users_sessions` has held real, un-revocable session rows since the
// very first migration (see 20260919_080426_totp_admin_2fa.ts's corrected
// comment) — every admin who has ever logged in has a standing session
// that this and future revokeUserSessions calls can finally act on.
// Deploying this once, deliberately, forces every admin (including
// whoever runs the deploy) to log in again afterward.
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`DELETE FROM "users_sessions";`)
}

// No meaningful down: the deleted sessions (and the JWTs a client may
// still hold pointing at them) are gone regardless: rolling this migration
// back cannot restore either.
export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {}
