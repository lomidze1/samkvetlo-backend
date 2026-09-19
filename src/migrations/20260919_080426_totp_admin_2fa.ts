import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// ADR 0018 §1 (T5.17): Users.totpSecret / totpLastStep / totpEnabledAt.
//
// Code review finding, then reverted: a first version of this fix also ran
// `UPDATE "users" SET "sessions" = '[]'::jsonb` here, meaning to invalidate
// any session/cookie issued before 2FA was required. That statement
// crashes migrate — `sessions` is Payload's own array field, stored as the
// separate `users_sessions` child table (id / _parent_id / created_at /
// expires_at), not a `sessions` column on `users` itself; there never was
// one to update. `users_sessions` has existed since the very first
// migration (20260915_133239) and — corrected from an earlier version of
// this comment, which wrongly concluded sessions weren't actually being
// tracked/revocable at all — real session rows are written there on every
// login/refresh (`useSessions: true`, Payload's own default). What was
// missing was ever *deleting* a row from it: ADR 0018 addendum A
// (T5.17a, revoke_sessions_2fa migration) is that fix.
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "users" ADD COLUMN "totp_secret" varchar;
  ALTER TABLE "users" ADD COLUMN "totp_last_step" numeric;
  ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "users" DROP COLUMN "totp_secret";
  ALTER TABLE "users" DROP COLUMN "totp_last_step";
  ALTER TABLE "users" DROP COLUMN "totp_enabled_at";`)
}
