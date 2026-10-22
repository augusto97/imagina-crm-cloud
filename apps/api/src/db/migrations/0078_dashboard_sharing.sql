-- v0.1.292 (ADR-S50) — Compartir un tablero hacia afuera.
--
-- `public_dashboards`: el enlace público de sólo lectura (token opaco → tablero).
-- SIN RLS, como `public_lists`: se consulta por token ANTES de conocer la
-- empresa. Guarda quién publicó: los datos se calculan con SU acceso.
CREATE TABLE IF NOT EXISTS "public_dashboards" (
    "token" varchar(64) PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "dashboard_id" bigint NOT NULL REFERENCES "dashboards" ("id") ON DELETE CASCADE,
    "published_by" bigint NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
    "expires_at" varchar(10),
    "allowed_domains" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "allow_period" boolean NOT NULL DEFAULT false,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "public_dashboards_dashboard_ux" ON "public_dashboards" ("dashboard_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_dashboards_tenant_ix" ON "public_dashboards" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_dashboards_published_by_ix" ON "public_dashboards" ("published_by");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "public_dashboards" TO imagina_app;--> statement-breakpoint

-- `dashboard_subscriptions`: el envío programado por correo (RLS por empresa).
-- El horario lo registra la cola (un job scheduler por suscripción).
CREATE TABLE IF NOT EXISTS "dashboard_subscriptions" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "dashboard_id" bigint NOT NULL REFERENCES "dashboards" ("id") ON DELETE CASCADE,
    "owner_id" bigint NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
    "enabled" boolean NOT NULL DEFAULT true,
    "frequency" varchar(8) NOT NULL DEFAULT 'weekly',
    "weekdays" jsonb NOT NULL DEFAULT '[1]'::jsonb,
    "month_day" smallint NOT NULL DEFAULT 1,
    "hour" smallint NOT NULL DEFAULT 8,
    "minute" smallint NOT NULL DEFAULT 0,
    "time_zone" varchar(64),
    "recipient_user_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "recipient_emails" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "subject" varchar(200) NOT NULL DEFAULT '',
    "message" text NOT NULL DEFAULT '',
    "attach_pdf" boolean NOT NULL DEFAULT false,
    "last_sent_at" timestamptz,
    "last_status" varchar(12),
    "last_error" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_subscriptions_dashboard_ix" ON "dashboard_subscriptions" ("tenant_id", "dashboard_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_subscriptions_dashboard_fk_ix" ON "dashboard_subscriptions" ("dashboard_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_subscriptions_owner_ix" ON "dashboard_subscriptions" ("owner_id");--> statement-breakpoint
ALTER TABLE "dashboard_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dashboard_subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "dashboard_subscriptions"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "dashboard_subscriptions" TO imagina_app;
