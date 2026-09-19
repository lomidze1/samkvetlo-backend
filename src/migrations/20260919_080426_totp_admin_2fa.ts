import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// ADR 0018 §1 (T5.17): Users.totpSecret / totpLastStep / totpEnabledAt.
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "users" ADD COLUMN "totp_secret" varchar;
  ALTER TABLE "users" ADD COLUMN "totp_last_step" numeric;
  ALTER TABLE "users" ADD COLUMN "totp_enabled_at" timestamp(3) with time zone;`)

  // Code review finding: 2FA is now required to log in at all (requireTotp
  // runs in beforeLogin), but any session/cookie issued *before* this
  // migration was never checked against that gate. Clearing every existing
  // session forces a fresh login through requireTotp for everyone,
  // including whoever runs this migration — there is no partially-migrated
  // window where an old session still works.
  await db.execute(sql`UPDATE "users" SET "sessions" = '[]'::jsonb;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "users" DROP COLUMN "totp_secret";
  ALTER TABLE "users" DROP COLUMN "totp_last_step";
  ALTER TABLE "users" DROP COLUMN "totp_enabled_at";`)
}
