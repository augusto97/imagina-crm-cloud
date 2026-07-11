-- Archivos propios (ADR-S16 / STANDALONE §10). Metadata en DB; los bytes
-- viven detrás de la interfaz FileStorage (driver local en disco hoy;
-- S3-compatible con URLs prefirmadas como upgrade sin tocar esta tabla).
-- Los campos tipo `file` guardan el ID del attachment como valor.
CREATE TABLE IF NOT EXISTS "attachments" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id"),
    "filename" text NOT NULL,
    "mime" text NOT NULL DEFAULT 'application/octet-stream',
    "size_bytes" bigint NOT NULL DEFAULT 0,
    "storage_key" text NOT NULL,
    "created_by" bigint NOT NULL REFERENCES "users" ("id"),
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "attachments"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

CREATE INDEX "attachments_tenant_idx" ON "attachments" ("tenant_id", "id" DESC);
