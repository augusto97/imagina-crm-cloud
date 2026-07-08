CREATE TABLE "app_releases" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "app_releases_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"version" varchar(64) NOT NULL,
	"channel" varchar(32) DEFAULT 'stable' NOT NULL,
	"bundle_url" text NOT NULL,
	"checksum" varchar(128),
	"released_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "app_releases_version_channel_ux" ON "app_releases" USING btree ("version","channel");--> statement-breakpoint
CREATE INDEX "app_releases_channel_released_idx" ON "app_releases" USING btree ("channel","released_at");