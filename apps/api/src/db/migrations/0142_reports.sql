-- v0.1.464 (J1) — Informes: un documento armado con bloques (título, texto,
-- indicadores, gráficos y tablas) donde cada bloque de datos sale de su
-- propia lista. Los bloques se guardan como jsonb y referencian listas y
-- campos por ID. RLS por empresa, como `dashboards`.
CREATE TABLE IF NOT EXISTS "reports" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "description" text,
    "blocks" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "visibility" varchar(16) NOT NULL DEFAULT 'workspace',
    "allowed_roles" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "position" integer NOT NULL DEFAULT 0,
    "created_by" bigint NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reports_tenant_ix" ON "reports" ("tenant_id", "position", "id");--> statement-breakpoint
ALTER TABLE "reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "reports"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "reports" TO imagina_app;--> statement-breakpoint
-- El envío programado por correo se generaliza: cada suscripción manda UN
-- tablero o UN informe (nunca los dos ni ninguno). Mismo horario, cola,
-- destinatarios, cuota y Problemas que los tableros (ADR-S50).
ALTER TABLE "dashboard_subscriptions" ALTER COLUMN "dashboard_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "dashboard_subscriptions" ADD COLUMN IF NOT EXISTS "report_id" bigint REFERENCES "reports" ("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "dashboard_subscriptions" DROP CONSTRAINT IF EXISTS "dashboard_subscriptions_target_ck";--> statement-breakpoint
ALTER TABLE "dashboard_subscriptions" ADD CONSTRAINT "dashboard_subscriptions_target_ck"
    CHECK (("dashboard_id" IS NULL) <> ("report_id" IS NULL));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "dashboard_subscriptions_report_ix" ON "dashboard_subscriptions" ("report_id");
