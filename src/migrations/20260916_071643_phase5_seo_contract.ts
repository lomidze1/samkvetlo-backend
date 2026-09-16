import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TABLE "categories_old_slugs" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"slug" varchar NOT NULL
  );
  
  CREATE TABLE "products_old_slugs" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"slug" varchar
  );
  
  CREATE TABLE "_products_v_version_old_slugs" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" serial PRIMARY KEY NOT NULL,
  	"slug" varchar,
  	"_uuid" varchar
  );
  
  ALTER TABLE "site_settings" ADD COLUMN "store_publish_address" boolean DEFAULT false;
  ALTER TABLE "site_settings" ADD COLUMN "store_street_address" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "store_address_locality" varchar;
  ALTER TABLE "site_settings" ADD COLUMN "store_postal_code" varchar;
  ALTER TABLE "categories_old_slugs" ADD CONSTRAINT "categories_old_slugs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_old_slugs" ADD CONSTRAINT "products_old_slugs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_products_v_version_old_slugs" ADD CONSTRAINT "_products_v_version_old_slugs_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."_products_v"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "categories_old_slugs_order_idx" ON "categories_old_slugs" USING btree ("_order");
  CREATE INDEX "categories_old_slugs_parent_id_idx" ON "categories_old_slugs" USING btree ("_parent_id");
  CREATE INDEX "categories_old_slugs_slug_idx" ON "categories_old_slugs" USING btree ("slug");
  CREATE INDEX "products_old_slugs_order_idx" ON "products_old_slugs" USING btree ("_order");
  CREATE INDEX "products_old_slugs_parent_id_idx" ON "products_old_slugs" USING btree ("_parent_id");
  CREATE INDEX "products_old_slugs_slug_idx" ON "products_old_slugs" USING btree ("slug");
  CREATE INDEX "_products_v_version_old_slugs_order_idx" ON "_products_v_version_old_slugs" USING btree ("_order");
  CREATE INDEX "_products_v_version_old_slugs_parent_id_idx" ON "_products_v_version_old_slugs" USING btree ("_parent_id");
  CREATE INDEX "_products_v_version_old_slugs_slug_idx" ON "_products_v_version_old_slugs" USING btree ("slug");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "categories_old_slugs" CASCADE;
  DROP TABLE "products_old_slugs" CASCADE;
  DROP TABLE "_products_v_version_old_slugs" CASCADE;
  ALTER TABLE "site_settings" DROP COLUMN "store_publish_address";
  ALTER TABLE "site_settings" DROP COLUMN "store_street_address";
  ALTER TABLE "site_settings" DROP COLUMN "store_address_locality";
  ALTER TABLE "site_settings" DROP COLUMN "store_postal_code";`)
}
