-- v0.1.268 (ADR-S36) — Almacenamiento propio por empresa. Cada archivo
-- recuerda DÓNDE quedó: NULL = el servidor de la plataforma (cuenta para el
-- plan); un id = la conexión de Integraciones de la empresa (su bucket).
-- Sin ON DELETE: borrar una conexión con archivos adentro se rechaza antes en
-- la app (se pierden los enlaces), y la FK es la última red.
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "storage_connection_id" bigint REFERENCES "connections" ("id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachments_storage_connection_ix" ON "attachments" ("tenant_id", "storage_connection_id");
