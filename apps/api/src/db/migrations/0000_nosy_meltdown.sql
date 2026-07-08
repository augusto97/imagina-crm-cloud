CREATE TYPE "public"."membership_role" AS ENUM('admin', 'manager', 'agent', 'viewer', 'client');--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "tenants_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" varchar(63) NOT NULL,
	"name" text NOT NULL,
	"plan" varchar(32) DEFAULT 'trial' NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "users_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" varchar(255) NOT NULL,
	"password_hash" text NOT NULL,
	"name" text NOT NULL,
	"locale" varchar(10) DEFAULT 'es' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"user_id" bigint NOT NULL,
	"tenant_id" bigint NOT NULL,
	"role" "membership_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_user_id_tenant_id_pk" PRIMARY KEY("user_id","tenant_id")
);
--> statement-breakpoint
CREATE TABLE "lists" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "lists_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"slug" varchar(63) NOT NULL,
	"name" text NOT NULL,
	"icon" varchar(64),
	"color" varchar(32),
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fields" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "fields_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"list_id" bigint NOT NULL,
	"slug" varchar(63) NOT NULL,
	"label" text NOT NULL,
	"type" varchar(32) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_unique" boolean DEFAULT false NOT NULL,
	"is_indexed" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "records" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "records_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"tenant_id" bigint NOT NULL,
	"list_id" bigint NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "records" ADD CONSTRAINT "records_list_id_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_ux" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "memberships_tenant_idx" ON "memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lists_tenant_slug_ux" ON "lists" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "fields_list_slug_ux" ON "fields" USING btree ("list_id","slug");--> statement-breakpoint
CREATE INDEX "fields_tenant_idx" ON "fields" USING btree ("tenant_id");