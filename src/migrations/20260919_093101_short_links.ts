import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "short_links" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"slug" varchar NOT NULL,
  	"target" varchar NOT NULL,
  	"utm_source" varchar,
  	"utm_medium" varchar,
  	"utm_campaign" varchar,
  	"active" boolean DEFAULT true,
  	"note" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "short_links_id" integer;
  CREATE UNIQUE INDEX "short_links_slug_idx" ON "short_links" USING btree ("slug");
  CREATE INDEX "short_links_updated_at_idx" ON "short_links" USING btree ("updated_at");
  CREATE INDEX "short_links_created_at_idx" ON "short_links" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_short_links_fk" FOREIGN KEY ("short_links_id") REFERENCES "public"."short_links"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_short_links_id_idx" ON "payload_locked_documents_rels" USING btree ("short_links_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "short_links" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "short_links" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_short_links_fk";
  
  DROP INDEX "payload_locked_documents_rels_short_links_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "short_links_id";`)
}
