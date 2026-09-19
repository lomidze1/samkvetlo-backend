import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

// ADR 0014 §12 (D25), T5.12: site_settings.retentionYears — the retention
// cron's anonymization clock (default 2 years).
export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings" ADD COLUMN "retention_years" numeric DEFAULT 2;`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "site_settings" DROP COLUMN "retention_years";`)
}
