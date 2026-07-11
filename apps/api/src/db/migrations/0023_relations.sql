-- Relaciones entre registros (campos tipo `relation` — CONTRACT §3, paridad
-- con `wp_imcrm_relations` del plugin). El valor NO vive en `records.data`:
-- cada vínculo es una fila (source → target) por campo. Tenant-scoped con RLS
-- (mismo patrón que records). El borrado de un field o el hard-delete de un
-- record limpian en cascada; el soft-delete se filtra al leer (JOIN records).
CREATE TABLE IF NOT EXISTS "relations" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id"),
    "field_id" bigint NOT NULL REFERENCES "fields" ("id") ON DELETE CASCADE,
    "source_record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "target_record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "position" integer NOT NULL DEFAULT 0,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "relations_unique_link" UNIQUE ("tenant_id", "field_id", "source_record_id", "target_record_id")
);--> statement-breakpoint

ALTER TABLE "relations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "relations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "relations"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

CREATE INDEX "relations_source_idx" ON "relations" ("tenant_id", "source_record_id");--> statement-breakpoint
CREATE INDEX "relations_target_idx" ON "relations" ("tenant_id", "target_record_id");
