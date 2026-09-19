import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// ADR 0018 §1 (T5.17): Users.totpSecret / totpLastStep / totpEnabledAt.
//
// Code review finding, then reverted: a first version of this fix also ran
// `UPDATE "users" SET "sessions" = '[]'::jsonb` here, meaning to invalidate
// any session/cookie issued before 2FA was required. That statement
// crashes migrate — `users` has had no `sessions` column since the very
// first migration (20260915_133239), even though Payload's `useSessions`
// defaults to true and payload-types.ts lists the field: the local
// dev/test schema (Payload's schema-push, not migrate) silently has the
// column, but every migrated database (prod included) never got it, so
// nothing is actually being tracked/revoked there today. That gap is
// real but pre-existing and unrelated to this migration — flagged
// separately for chief-architect rather than papered over here.
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
