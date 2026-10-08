-- v0.1.267 (ADR-S35 fase 2) — Numeración consecutiva de los documentos y
-- descarga desde el portal del cliente.
ALTER TABLE "document_templates" ADD COLUMN IF NOT EXISTS "next_number" integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE "document_templates" ADD COLUMN IF NOT EXISTS "portal_visible" boolean NOT NULL DEFAULT false;--> statement-breakpoint
-- Un número por (plantilla, registro): se asigna la primera vez que el
-- documento se genera de verdad y se conserva. El formato ("CC-0042") se
-- guarda al emitirlo: cambiar el prefijo después no renumera lo emitido.
CREATE TABLE IF NOT EXISTS "document_numbers" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "template_id" bigint NOT NULL REFERENCES "document_templates" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "number" integer NOT NULL,
    "label" varchar(40) NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "document_numbers_record_uq" UNIQUE ("template_id", "record_id"),
    CONSTRAINT "document_numbers_number_uq" UNIQUE ("template_id", "number")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_numbers_record_ix" ON "document_numbers" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_numbers_tenant_ix" ON "document_numbers" ("tenant_id");--> statement-breakpoint
ALTER TABLE "document_numbers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_numbers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_numbers"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
