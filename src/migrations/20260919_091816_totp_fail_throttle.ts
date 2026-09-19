import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "users" ADD COLUMN "totp_fail_count" numeric DEFAULT 0;
  ALTER TABLE "users" ADD COLUMN "totp_fail_window_start" timestamp(3) with time zone;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "users" DROP COLUMN "totp_fail_count";
  ALTER TABLE "users" DROP COLUMN "totp_fail_window_start";`)
}
