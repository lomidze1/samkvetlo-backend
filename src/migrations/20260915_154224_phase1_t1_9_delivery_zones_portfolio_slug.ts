import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "delivery_zones" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar,
  	"examples" varchar,
  	"fee_gel" numeric NOT NULL,
  	"sort_order" numeric DEFAULT 100,
  	"active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "portfolio" ADD COLUMN "slug" varchar;
  ALTER TABLE "_portfolio_v" ADD COLUMN "version_slug" varchar;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "delivery_zones_id" integer;
  CREATE UNIQUE INDEX "delivery_zones_slug_idx" ON "delivery_zones" USING btree ("slug");
  CREATE INDEX "delivery_zones_updated_at_idx" ON "delivery_zones" USING btree ("updated_at");
  CREATE INDEX "delivery_zones_created_at_idx" ON "delivery_zones" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_delivery_zones_fk" FOREIGN KEY ("delivery_zones_id") REFERENCES "public"."delivery_zones"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "portfolio_slug_idx" ON "portfolio" USING btree ("slug");
  CREATE INDEX "_portfolio_v_version_version_slug_idx" ON "_portfolio_v" USING btree ("version_slug");
  CREATE INDEX "payload_locked_documents_rels_delivery_zones_id_idx" ON "payload_locked_documents_rels" USING btree ("delivery_zones_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "delivery_zones" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "delivery_zones" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_delivery_zones_fk";
  
  DROP INDEX "portfolio_slug_idx";
  DROP INDEX "_portfolio_v_version_version_slug_idx";
  DROP INDEX "payload_locked_documents_rels_delivery_zones_id_idx";
  ALTER TABLE "portfolio" DROP COLUMN "slug";
  ALTER TABLE "_portfolio_v" DROP COLUMN "version_slug";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "delivery_zones_id";`)
}
