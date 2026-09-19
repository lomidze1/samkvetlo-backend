import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TYPE "public"."enum_pages_slug" ADD VALUE 'terms';`)
}

// M11 review fix (low): irreversible once any `pages.slug = 'terms'` row
// exists (M7's `/terms` page, seeded by `pnpm seed:base`) — recreating the
// enum without 'terms' and casting `slug` back to it fails with a Postgres
// "invalid input value for enum" error, because that value would no longer
// exist in the type. Rolling back past this migration on such a database
// requires deleting or renaming that page's row first; this is not done
// automatically here since it would silently drop/rename real content.
export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "pages" ALTER COLUMN "slug" SET DATA TYPE text;
  DROP TYPE "public"."enum_pages_slug";
  CREATE TYPE "public"."enum_pages_slug" AS ENUM('how-we-work', 'about', 'delivery', 'contact', 'privacy');
  ALTER TABLE "pages" ALTER COLUMN "slug" SET DATA TYPE "public"."enum_pages_slug" USING "slug"::"public"."enum_pages_slug";`)
}
