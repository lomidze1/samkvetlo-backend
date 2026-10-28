import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_users_role" AS ENUM('super-admin', 'admin');
  ALTER TABLE "users" ADD COLUMN "role" "enum_users_role" DEFAULT 'admin';
  ALTER TABLE "users" ADD COLUMN "enrollment_open_until" timestamp(3) with time zone;`)
  // ADR 0018 addendum C: accounts that existed before roles keep the full
  // rights they had (every user could manage users until now).
  await db.execute(sql`UPDATE "users" SET "role" = 'super-admin';`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "users" DROP COLUMN "role";
  ALTER TABLE "users" DROP COLUMN "enrollment_open_until";
  DROP TYPE "public"."enum_users_role";`)
}
