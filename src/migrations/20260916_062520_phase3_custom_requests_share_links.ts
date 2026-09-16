import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_custom_requests_status_history_from" AS ENUM('new', 'contacted', 'quoted', 'won', 'lost');
  CREATE TYPE "public"."enum_custom_requests_status_history_to" AS ENUM('new', 'contacted', 'quoted', 'won', 'lost');
  CREATE TYPE "public"."enum_custom_requests_notifications_channel" AS ENUM('email', 'sms');
  CREATE TYPE "public"."enum_custom_requests_notifications_status" AS ENUM('sent', 'failed');
  CREATE TYPE "public"."enum_custom_requests_category" AS ENUM('iconostasis', 'vestments', 'vessels', 'icon', 'other');
  CREATE TYPE "public"."enum_custom_requests_status" AS ENUM('new', 'contacted', 'quoted', 'won', 'lost');
  CREATE TYPE "public"."enum_share_links_kind" AS ENUM('cart', 'configuration');
  CREATE TABLE "custom_requests_status_history" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"from" "enum_custom_requests_status_history_from",
  	"to" "enum_custom_requests_status_history_to" NOT NULL,
  	"by_id" integer,
  	"at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "custom_requests_notifications" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"channel" "enum_custom_requests_notifications_channel" NOT NULL,
  	"status" "enum_custom_requests_notifications_status" NOT NULL,
  	"error" varchar,
  	"at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "custom_requests" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"number" varchar,
  	"submission_id" varchar NOT NULL,
  	"name" varchar NOT NULL,
  	"surname" varchar NOT NULL,
  	"phone" varchar NOT NULL,
  	"church" varchar NOT NULL,
  	"city" varchar,
  	"email" varchar,
  	"category" "enum_custom_requests_category" NOT NULL,
  	"product_id" integer,
  	"description" varchar NOT NULL,
  	"budget_text" varchar,
  	"deadline_text" varchar,
  	"anonymized_at" timestamp(3) with time zone,
  	"status" "enum_custom_requests_status" DEFAULT 'new' NOT NULL,
  	"status_changed_at" timestamp(3) with time zone,
  	"internal_notes" varchar,
  	"ip_hash" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "custom_requests_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"private_files_id" integer
  );
  
  CREATE TABLE "share_links_cart_lines" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"variant_id" numeric NOT NULL,
  	"qty" numeric NOT NULL,
  	"configuration_id" varchar
  );
  
  CREATE TABLE "share_links" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"kind" "enum_share_links_kind" NOT NULL,
  	"token_hash" varchar NOT NULL,
  	"owner_secret_hash" varchar NOT NULL,
  	"expires_at" timestamp(3) with time zone NOT NULL,
  	"revoked_at" timestamp(3) with time zone,
  	"view_count" numeric DEFAULT 0,
  	"ip_hash" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "custom_requests_id" integer;
  ALTER TABLE "payload_locked_documents_rels" ADD COLUMN "share_links_id" integer;
  ALTER TABLE "custom_requests_status_history" ADD CONSTRAINT "custom_requests_status_history_by_id_users_id_fk" FOREIGN KEY ("by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "custom_requests_status_history" ADD CONSTRAINT "custom_requests_status_history_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."custom_requests"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "custom_requests_notifications" ADD CONSTRAINT "custom_requests_notifications_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."custom_requests"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "custom_requests" ADD CONSTRAINT "custom_requests_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "custom_requests_rels" ADD CONSTRAINT "custom_requests_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."custom_requests"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "custom_requests_rels" ADD CONSTRAINT "custom_requests_rels_private_files_fk" FOREIGN KEY ("private_files_id") REFERENCES "public"."private_files"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "share_links_cart_lines" ADD CONSTRAINT "share_links_cart_lines_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "custom_requests_status_history_order_idx" ON "custom_requests_status_history" USING btree ("_order");
  CREATE INDEX "custom_requests_status_history_parent_id_idx" ON "custom_requests_status_history" USING btree ("_parent_id");
  CREATE INDEX "custom_requests_status_history_by_idx" ON "custom_requests_status_history" USING btree ("by_id");
  CREATE INDEX "custom_requests_notifications_order_idx" ON "custom_requests_notifications" USING btree ("_order");
  CREATE INDEX "custom_requests_notifications_parent_id_idx" ON "custom_requests_notifications" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "custom_requests_number_idx" ON "custom_requests" USING btree ("number");
  CREATE UNIQUE INDEX "custom_requests_submission_id_idx" ON "custom_requests" USING btree ("submission_id");
  CREATE INDEX "custom_requests_product_idx" ON "custom_requests" USING btree ("product_id");
  CREATE INDEX "custom_requests_updated_at_idx" ON "custom_requests" USING btree ("updated_at");
  CREATE INDEX "custom_requests_created_at_idx" ON "custom_requests" USING btree ("created_at");
  CREATE INDEX "custom_requests_rels_order_idx" ON "custom_requests_rels" USING btree ("order");
  CREATE INDEX "custom_requests_rels_parent_idx" ON "custom_requests_rels" USING btree ("parent_id");
  CREATE INDEX "custom_requests_rels_path_idx" ON "custom_requests_rels" USING btree ("path");
  CREATE INDEX "custom_requests_rels_private_files_id_idx" ON "custom_requests_rels" USING btree ("private_files_id");
  CREATE INDEX "share_links_cart_lines_order_idx" ON "share_links_cart_lines" USING btree ("_order");
  CREATE INDEX "share_links_cart_lines_parent_id_idx" ON "share_links_cart_lines" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "share_links_token_hash_idx" ON "share_links" USING btree ("token_hash");
  CREATE INDEX "share_links_updated_at_idx" ON "share_links" USING btree ("updated_at");
  CREATE INDEX "share_links_created_at_idx" ON "share_links" USING btree ("created_at");
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_custom_requests_fk" FOREIGN KEY ("custom_requests_id") REFERENCES "public"."custom_requests"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_share_links_fk" FOREIGN KEY ("share_links_id") REFERENCES "public"."share_links"("id") ON DELETE cascade ON UPDATE no action;
  CREATE INDEX "payload_locked_documents_rels_custom_requests_id_idx" ON "payload_locked_documents_rels" USING btree ("custom_requests_id");
  CREATE INDEX "payload_locked_documents_rels_share_links_id_idx" ON "payload_locked_documents_rels" USING btree ("share_links_id");`)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "custom_requests_status_history" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "custom_requests_notifications" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "custom_requests" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "custom_requests_rels" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "share_links_cart_lines" DISABLE ROW LEVEL SECURITY;
  ALTER TABLE "share_links" DISABLE ROW LEVEL SECURITY;
  DROP TABLE "custom_requests_status_history" CASCADE;
  DROP TABLE "custom_requests_notifications" CASCADE;
  DROP TABLE "custom_requests" CASCADE;
  DROP TABLE "custom_requests_rels" CASCADE;
  DROP TABLE "share_links_cart_lines" CASCADE;
  DROP TABLE "share_links" CASCADE;
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_custom_requests_fk";
  
  ALTER TABLE "payload_locked_documents_rels" DROP CONSTRAINT "payload_locked_documents_rels_share_links_fk";
  
  DROP INDEX "payload_locked_documents_rels_custom_requests_id_idx";
  DROP INDEX "payload_locked_documents_rels_share_links_id_idx";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "custom_requests_id";
  ALTER TABLE "payload_locked_documents_rels" DROP COLUMN "share_links_id";
  DROP TYPE "public"."enum_custom_requests_status_history_from";
  DROP TYPE "public"."enum_custom_requests_status_history_to";
  DROP TYPE "public"."enum_custom_requests_notifications_channel";
  DROP TYPE "public"."enum_custom_requests_notifications_status";
  DROP TYPE "public"."enum_custom_requests_category";
  DROP TYPE "public"."enum_custom_requests_status";
  DROP TYPE "public"."enum_share_links_kind";`)
}
