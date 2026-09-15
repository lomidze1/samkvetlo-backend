import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_orders_status_history_from" AS ENUM('new', 'contacted', 'confirmed', 'paid', 'ordered-from-supplier', 'in-transit', 'delivered', 'cancelled');
  CREATE TYPE "public"."enum_orders_status_history_to" AS ENUM('new', 'contacted', 'confirmed', 'paid', 'ordered-from-supplier', 'in-transit', 'delivered', 'cancelled');
  CREATE TYPE "public"."enum_orders_notifications_channel" AS ENUM('email', 'sms');
  CREATE TYPE "public"."enum_orders_notifications_status" AS ENUM('sent', 'failed');
  CREATE TYPE "public"."enum_orders_status" AS ENUM('new', 'contacted', 'confirmed', 'paid', 'ordered-from-supplier', 'in-transit', 'delivered', 'cancelled');
  CREATE TYPE "public"."enum_portfolio_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum__portfolio_v_version_status" AS ENUM('draft', 'published');
  CREATE TYPE "public"."enum_pages_slug" AS ENUM('how-we-work', 'about', 'delivery', 'contact', 'privacy');
  CREATE TABLE "orders_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"variant_id" integer NOT NULL,
  	"product_title" varchar NOT NULL,
  	"variant_title" varchar NOT NULL,
  	"sku" varchar NOT NULL,
  	"unit_price" numeric NOT NULL,
  	"qty" numeric NOT NULL,
  	"price_on_confirmation" numeric,
  	"line_total" numeric,
  	"patriarchate_letter_received" boolean DEFAULT false,
  	"patriarchate_letter_file_id" integer
  );
  
  CREATE TABLE "orders_status_history" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"from" "enum_orders_status_history_from",
  	"to" "enum_orders_status_history_to" NOT NULL,
  	"by_id" integer,
  	"at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "orders_notifications" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"channel" "enum_orders_notifications_channel" NOT NULL,
  	"status" "enum_orders_notifications_status" NOT NULL,
  	"error" varchar,
  	"at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "orders" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"number" varchar,
  	"submission_id" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"surname" varchar NOT NULL,
  	"phone" varchar NOT NULL,
  	"church" varchar NOT NULL,
  	"city" varchar,
  	"email" varchar,
  	"comment" varchar,
  	"anonymized_at" timestamp(3) with time zone,
  	"delivery_zone_slug" varchar,
  	"delivery_zone_name" varchar,
  	"delivery_fee_gel" numeric,
  	"items_total_gel" numeric,
  	"total_gel" numeric,
  	"status" "enum_orders_status" DEFAULT 'new' NOT NULL,
  	"status_changed_at" timestamp(3) with time zone,
  	"payment_amount_gel" numeric,
  	"payment_paid_at" timestamp(3) with time zone,
  	"payment_received_by" varchar,
  	"internal_notes" varchar,
  	"supplier_order_no" varchar,
  	"customs_declaration" varchar,
  	"ip_hash" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "portfolio" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"church" varchar,
  	"city" varchar,
  	"consent" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"_status" "enum_portfolio_status" DEFAULT 'draft'
  );
  
  CREATE TABLE "portfolio_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"media_id" integer,
  	"products_id" integer
  );
  
  CREATE TABLE "_portfolio_v" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"parent_id" integer,
  	"version_church" varchar,
  	"version_city" varchar,
  	"version_consent" boolean DEFAULT false,
  	"version_updated_at" timestamp(3) with time zone,
  	"version_created_at" timestamp(3) with time zone,
  	"version__status" "enum__portfolio_v_version_status" DEFAULT 'draft',
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"latest" boolean
  );
  
  CREATE TABLE "_portfolio_v_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"media_id" integer,
  	"products_id" integer
  );
  
  CREATE TABLE "pages" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"slug" "enum_pages_slug" NOT NULL,
  	"title" varchar NOT NULL,
  	"content" jsonb NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "site_settings_social" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"url" varchar NOT NULL
  );
  
  CREATE TABLE "site_settings_owner_emails" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"email" varchar NOT NULL
  );
  
  CREATE TABLE "site_settings_owner_phones" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"phone" varchar NOT NULL
  );
  
  CREATE TABLE "site_settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"phone" varchar,
  	"email" varchar,
  	"address" varchar,
  	"configurator_enabled" boolean DEFAULT false,
  	"notify_customer" boolean DEFAULT false,
  	"share_link_ttl_days" numeric DEFAULT 90,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "orders_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "portfolio_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "pages_id" integer;
  ALTER TABLE "orders_items" ADD CONSTRAINT "orders_items_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "orders_items" ADD CONSTRAINT "orders_items_patriarchate_letter_file_id_private_files_id_fk" FOREIGN KEY ("patriarchate_letter_file_id") REFERENCES "public"."private_files"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "orders_items" ADD CONSTRAINT "orders_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "orders_status_history" ADD CONSTRAINT "orders_status_history_by_id_users_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "orders_status_history" ADD CONSTRAINT "orders_status_history_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "orders_notifications" ADD CONSTRAINT "orders_notifications_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "portfolio_rels" ADD CONSTRAINT "portfolio_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."portfolio"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "portfolio_rels" ADD CONSTRAINT "portfolio_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "portfolio_rels" ADD CONSTRAINT "portfolio_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_portfolio_v" ADD CONSTRAINT "_portfolio_v_parent_id_portfolio_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."portfolio"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "_portfolio_v_rels" ADD CONSTRAINT "_portfolio_v_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."_portfolio_v"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_portfolio_v_rels" ADD CONSTRAINT "_portfolio_v_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "_portfolio_v_rels" ADD CONSTRAINT "_portfolio_v_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "site_settings_social" ADD CONSTRAINT "site_settings_social_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."site_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "site_settings_owner_emails" ADD CONSTRAINT "site_settings_owner_emails_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."site_settings"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "site_settings_owner_phones" ADD CONSTRAINT "site_settings_owner_phones_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."site_settings"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "orders_items_order_idx" ON "orders_items" USING btree ("_order");
  CREATE INDEX "orders_items_parent_id_idx" ON "orders_items" USING btree ("_parent_id");
  CREATE INDEX "orders_items_variant_idx" ON "orders_items" USING btree ("variant_id");
  CREATE INDEX "orders_items_patriarchate_letter_patriarchate_letter_fil_idx" ON "orders_items" USING btree ("patriarchate_letter_file_id");
  CREATE INDEX "orders_status_history_order_idx" ON "orders_status_history" USING btree ("_order");
  CREATE INDEX "orders_status_history_parent_id_idx" ON "orders_status_history" USING btree ("_parent_id");
  CREATE INDEX "orders_status_history_by_idx" ON "orders_status_history" USING btree ("by_id");
  CREATE INDEX "orders_notifications_order_idx" ON "orders_notifications" USING btree ("_order");
  CREATE INDEX "orders_notifications_parent_id_idx" ON "orders_notifications" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "orders_number_idx" ON "orders" USING btree ("number");
  CREATE UNIQUE INDEX "orders_submission_id_idx" ON "orders" USING btree ("submission_id");
  CREATE INDEX "orders_updated_at_idx" ON "orders" USING btree ("updated_at");
  CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");
  CREATE INDEX "portfolio_updated_at_idx" ON "portfolio" USING btree ("updated_at");
  CREATE INDEX "portfolio_created_at_idx" ON "portfolio" USING btree ("created_at");
  CREATE INDEX "portfolio__status_idx" ON "portfolio" USING btree ("_status");
  CREATE INDEX "portfolio_rels_order_idx" ON "portfolio_rels" USING btree ("order");
  CREATE INDEX "portfolio_rels_parent_idx" ON "portfolio_rels" USING btree ("parent_id");
  CREATE INDEX "portfolio_rels_path_idx" ON "portfolio_rels" USING btree ("path");
  CREATE INDEX "portfolio_rels_media_id_idx" ON "portfolio_rels" USING btree ("media_id");
  CREATE INDEX "portfolio_rels_products_id_idx" ON "portfolio_rels" USING btree ("products_id");
  CREATE INDEX "_portfolio_v_parent_idx" ON "_portfolio_v" USING btree ("parent_id");
  CREATE INDEX "_portfolio_v_version_version_updated_at_idx" ON "_portfolio_v" USING btree ("version_updated_at");
  CREATE INDEX "_portfolio_v_version_version_created_at_idx" ON "_portfolio_v" USING btree ("version_created_at");
  CREATE INDEX "_portfolio_v_version_version__status_idx" ON "_portfolio_v" USING btree ("version__status");
  CREATE INDEX "_portfolio_v_created_at_idx" ON "_portfolio_v" USING btree ("created_at");
  CREATE INDEX "_portfolio_v_updated_at_idx" ON "_portfolio_v" USING btree ("updated_at");
  CREATE INDEX "_portfolio_v_latest_idx" ON "_portfolio_v" USING btree ("latest");
  CREATE INDEX "_portfolio_v_rels_order_idx" ON "_portfolio_v_rels" USING btree ("order");
  CREATE INDEX "_portfolio_v_rels_parent_idx" ON "_portfolio_v_rels" USING btree ("parent_id");
  CREATE INDEX "_portfolio_v_rels_path_idx" ON "_portfolio_v_rels" USING btree ("path");
  CREATE INDEX "_portfolio_v_rels_media_id_idx" ON "_portfolio_v_rels" USING btree ("media_id");
  CREATE INDEX "_portfolio_v_rels_products_id_idx" ON "_portfolio_v_rels" USING btree ("products_id");
  CREATE UNIQUE INDEX "pages_slug_idx" ON "pages" USING btree ("slug");
  CREATE INDEX "pages_updated_at_idx" ON "pages" USING btree ("updated_at");
  CREATE INDEX "pages_created_at_idx" ON "pages" USING btree ("created_at");
  CREATE INDEX "site_settings_social_order_idx" ON "site_settings_social" USING btree ("_order");
  CREATE INDEX "site_settings_social_parent_id_idx" ON "site_settings_social" USING btree ("_parent_id");
  CREATE INDEX "site_settings_owner_emails_order_idx" ON "site_settings_owner_emails" USING btree ("_order");
  CREATE INDEX "site_settings_owner_emails_parent_id_idx" ON "site_settings_owner_emails" USING btree ("_parent_id");
  CREATE INDEX "site_settings_owner_phones_order_idx" ON "site_settings_owner_phones" USING btree ("_order");
  CREATE INDEX "site_settings_owner_phones_parent_id_idx" ON "site_settings_owner_phones" USING btree ("_parent_id");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_orders_fk" FOREIGN KEY ("orders_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_portfolio_fk" FOREIGN KEY ("portfolio_id") REFERENCES "public"."portfolio"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_pages_fk" FOREIGN KEY ("pages_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_orders_id_idx" ON "payload_locked_documents_rels" USING btree ("orders_id");
  CREATE INDEX "payload_locked_documents_rels_portfolio_id_idx" ON "payload_locked_documents_rels" USING btree ("portfolio_id");
  CREATE INDEX "payload_locked_documents_rels_pages_id_idx" ON "payload_locked_documents_rels" USING btree ("pages_id");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "orders_items" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "orders_status_history" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "orders_notifications" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "orders" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "portfolio" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "portfolio_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_portfolio_v" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "_portfolio_v_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "pages" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "site_settings_social" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "site_settings_owner_emails" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "site_settings_owner_phones" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "site_settings" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "orders_items" CASCADE;
  DROP TABLE "orders_status_history" CASCADE;
  DROP TABLE "orders_notifications" CASCADE;
  DROP TABLE "orders" CASCADE;
  DROP TABLE "portfolio" CASCADE;
  DROP TABLE "portfolio_rels" CASCADE;
  DROP TABLE "_portfolio_v" CASCADE;
  DROP TABLE "_portfolio_v_rels" CASCADE;
  DROP TABLE "pages" CASCADE;
  DROP TABLE "site_settings_social" CASCADE;
  DROP TABLE "site_settings_owner_emails" CASCADE;
  DROP TABLE "site_settings_owner_phones" CASCADE;
  DROP TABLE "site_settings" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_orders_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_portfolio_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_pages_fk";
  
  DROP INDEX "payload_locked_documents_rels_orders_id_idx";
  DROP INDEX "payload_locked_documents_rels_portfolio_id_idx";
  DROP INDEX "payload_locked_documents_rels_pages_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "orders_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "portfolio_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "pages_id";
  DROP TYPE "public"."enum_orders_status_history_from";
  DROP TYPE "public"."enum_orders_status_history_to";
  DROP TYPE "public"."enum_orders_notifications_channel";
  DROP TYPE "public"."enum_orders_notifications_status";
  DROP TYPE "public"."enum_orders_status";
  DROP TYPE "public"."enum_portfolio_status";
  DROP TYPE "public"."enum__portfolio_v_version_status";
  DROP TYPE "public"."enum_pages_slug";`)
}
