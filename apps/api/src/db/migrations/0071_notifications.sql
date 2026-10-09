-- v0.1.276 (ADR-S40) — «Mi trabajo» + bandeja de avisos. Tres tablas de la
-- empresa (RLS): avisos por destinatario, registros que una persona sigue y
-- recordatorios personales.
CREATE TABLE IF NOT EXISTS "notifications" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "user_id" bigint NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
    "kind" varchar(16) NOT NULL,
    "list_id" bigint REFERENCES "lists" ("id") ON DELETE CASCADE,
    "record_id" bigint REFERENCES "records" ("id") ON DELETE CASCADE,
    "actor_id" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "title" varchar(300) NOT NULL,
    "body" text NOT NULL DEFAULT '',
    "read_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_user_ix" ON "notifications" ("tenant_id", "user_id", "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_unread_ix" ON "notifications" ("tenant_id", "user_id") WHERE "read_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_record_ix" ON "notifications" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_list_ix" ON "notifications" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notifications_created_ix" ON "notifications" ("created_at");--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "notifications"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "record_follows" (
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "user_id" bigint NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("tenant_id", "user_id", "record_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_follows_record_ix" ON "record_follows" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_follows_list_ix" ON "record_follows" ("list_id");--> statement-breakpoint
ALTER TABLE "record_follows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_follows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "record_follows"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "reminders" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "user_id" bigint NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
    "list_id" bigint REFERENCES "lists" ("id") ON DELETE CASCADE,
    "record_id" bigint REFERENCES "records" ("id") ON DELETE CASCADE,
    "remind_at" timestamptz NOT NULL,
    "note" varchar(500) NOT NULL DEFAULT '',
    "fired_at" timestamptz,
    "done_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminders_user_ix" ON "reminders" ("tenant_id", "user_id", "remind_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminders_due_ix" ON "reminders" ("remind_at") WHERE "fired_at" IS NULL AND "done_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminders_record_ix" ON "reminders" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminders_list_ix" ON "reminders" ("list_id");--> statement-breakpoint
ALTER TABLE "reminders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reminders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "reminders"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
