-- v0.1.455 — «Cuando un registro empieza a cumplir una condición».
--
-- Una fila por (automatización, registro) mientras el registro CUMPLE la
-- condición del disparador. El disparo es la transición «no estaba → está»:
-- `INSERT … ON CONFLICT DO NOTHING RETURNING` decide, así dos eventos a la vez
-- no disparan dos veces. Cuando el registro deja de cumplirla, la fila se
-- borra y puede volver a disparar si vuelve a entrar. Al activar la
-- automatización (o cambiar la condición) se siembran los que YA la cumplen
-- sin disparar (la línea de base).
CREATE TABLE IF NOT EXISTS "automation_matches" (
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "automation_id" bigint NOT NULL REFERENCES "automations" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "matched_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "automation_matches_pk" PRIMARY KEY ("automation_id", "record_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_matches_record_ix" ON "automation_matches" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automation_matches_tenant_ix" ON "automation_matches" ("tenant_id");--> statement-breakpoint
ALTER TABLE "automation_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "automation_matches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "automation_matches"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "automation_matches" TO imagina_app;
