import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// ADR 0006 (2026-09-19, owner decision): minMarkupUsd = 1000 -> minMarkupGel
// = 1500 (fixed GEL floor, no longer USD-converted). Existing rows get the
// new fixed value directly — the old USD amount is not convertible 1:1, and
// the owner decided the value itself (not just the unit).
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pricing_settings" ADD COLUMN "min_markup_gel" numeric DEFAULT 1500 NOT NULL;
  ALTER TABLE "pricing_settings" DROP COLUMN "min_markup_usd";`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pricing_settings" ADD COLUMN "min_markup_usd" numeric DEFAULT 1000 NOT NULL;
  ALTER TABLE "pricing_settings" DROP COLUMN "min_markup_gel";`)
}
