-- v0.1.289 — Automatizaciones: la acción «Esperar» es DURABLE (la corrida queda
-- en `waiting` en Postgres con la hora de reanudación, el puntero al paso que
-- sigue y el contexto acumulado: un reinicio o un Redis vaciado no la pierden)
-- y cada guardado deja una versión en el historial.
ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "resume_at" timestamptz;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "resumed_at" timestamptz;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "resume_state" jsonb;--> statement-breakpoint
-- El reloj de las esperas toma las vencidas por este índice (cross-empresa).
CREATE INDEX IF NOT EXISTS "automation_runs_waiting_ix" ON "automation_runs" ("resume_at") WHERE "status" = 'waiting';--> statement-breakpoint
-- Cancelar las esperas de una automatización (al pausarla) y contarlas.
CREATE INDEX IF NOT EXISTS "automation_runs_waiting_auto_ix" ON "automation_runs" ("tenant_id", "automation_id") WHERE "status" = 'waiting';--> statement-breakpoint
-- «Esperar hasta la fecha de un campo»: si alguien cambia esa fecha, la espera
-- se recalcula. Cada edición de un registro consulta este índice (casi siempre
-- vacío: sólo los registros con una corrida en espera tienen filas aquí).
CREATE INDEX IF NOT EXISTS "automation_runs_waiting_record_ix" ON "automation_runs" ("record_id") WHERE "status" = 'waiting';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "automation_versions" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "automation_id" bigint NOT NULL REFERENCES "automations" ("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "description" text,
    "trigger_type" text NOT NULL,
    "trigger_config" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "actions" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "is_active" boolean NOT NULL DEFAULT true,
    "author_id" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "note" varchar(300),
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_versions_auto_ix" ON "automation_versions" ("tenant_id", "automation_id", "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_versions_automation_ix" ON "automation_versions" ("automation_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_versions_author_ix" ON "automation_versions" ("author_id");--> statement-breakpoint
ALTER TABLE "automation_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automation_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "automation_versions"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
