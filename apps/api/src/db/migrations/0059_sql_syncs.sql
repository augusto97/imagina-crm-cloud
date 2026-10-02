-- v0.1.243 — Sincronizaciones desde SQL Server / Azure SQL.
--
-- Una conexión `sqlserver` puede tener VARIAS sincronizaciones (facturas,
-- clientes…): cada una ejecuta una consulta o un procedimiento almacenado y
-- carga el resultado en una lista, emparejando por una columna clave. Igual
-- que `connection_syncs` (ADR-S24), `settings` guarda lo que eligió la
-- persona y `state` lo que escribe el motor, así una corrida que guarda su
-- progreso no pisa un cambio de ajustes hecho en paralelo.
CREATE TABLE IF NOT EXISTS "sql_syncs" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "connection_id" bigint NOT NULL REFERENCES "connections" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "state" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "enabled" boolean NOT NULL DEFAULT true,
    "next_run_at" timestamptz,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "sql_syncs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sql_syncs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sql_syncs"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sql_syncs" TO imagina_app;--> statement-breakpoint
CREATE INDEX "sql_syncs_connection_ix" ON "sql_syncs" ("connection_id");--> statement-breakpoint
CREATE INDEX "sql_syncs_list_ix" ON "sql_syncs" ("list_id");--> statement-breakpoint
-- El tick global busca las que tocan (cross-tenant, por la conexión base).
CREATE INDEX "sql_syncs_due_ix" ON "sql_syncs" ("next_run_at") WHERE "enabled";
