-- v0.1.459 (G3) — Sincronizar una lista con una hoja de Google Sheets.
--
-- Una conexión `google_sheets` puede tener VARIAS sincronizaciones: cada una
-- une una pestaña de una planilla con una lista. Igual que `sql_syncs`,
-- `settings` guarda lo que eligió la persona y `state` lo que escribe el
-- motor, así una corrida que guarda su progreso no pisa un cambio de ajustes.
CREATE TABLE IF NOT EXISTS "sheet_syncs" (
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

ALTER TABLE "sheet_syncs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sheet_syncs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sheet_syncs"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sheet_syncs" TO imagina_app;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sheet_syncs_connection_ix" ON "sheet_syncs" ("connection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sheet_syncs_list_ix" ON "sheet_syncs" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sheet_syncs_tenant_ix" ON "sheet_syncs" ("tenant_id");--> statement-breakpoint
-- El tick global busca las que tocan (cross-tenant, por la conexión base).
CREATE INDEX IF NOT EXISTS "sheet_syncs_due_ix" ON "sheet_syncs" ("next_run_at") WHERE "enabled";--> statement-breakpoint

-- «La fila con la clave K de la hoja es el registro N». Vive FUERA de los
-- datos del registro (regla de oro nº 1). `snapshot` guarda lo último que se
-- sincronizó de cada celda, de cada lado (`{ s: {campo: texto}, a: {…} }`):
-- es lo que deja saber qué cambió en la hoja, qué cambió en la app y cuándo
-- cambió la MISMA celda en los dos. `fingerprint` es la huella de la fila de
-- la hoja (salta rápido las filas que no cambiaron). `removed`: la fila se
-- borró de la hoja y el registro quedó en la app — no se vuelve a agregar.
CREATE TABLE IF NOT EXISTS "sheet_sync_rows" (
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "sync_id" bigint NOT NULL REFERENCES "sheet_syncs" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "row_key" varchar(190) NOT NULL,
    "snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "fingerprint" varchar(40),
    "removed" boolean NOT NULL DEFAULT false,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("sync_id", "record_id")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sheet_sync_rows_key_uq" ON "sheet_sync_rows" ("sync_id", "row_key");--> statement-breakpoint
-- Borrar (purgar) un registro borra su vínculo: FK sin índice = escaneo.
CREATE INDEX IF NOT EXISTS "sheet_sync_rows_record_ix" ON "sheet_sync_rows" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sheet_sync_rows_tenant_ix" ON "sheet_sync_rows" ("tenant_id");--> statement-breakpoint
ALTER TABLE "sheet_sync_rows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sheet_sync_rows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sheet_sync_rows"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sheet_sync_rows" TO imagina_app;
