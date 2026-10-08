-- v0.1.266 (ADR-S35) — Plantillas de documentos PDF (cuentas de cobro,
-- recibos, proformas). Viven en una lista: sus variables son los campos de
-- esa lista. Se guarda el DISEÑO (bloques); el PDF se arma en el momento.
CREATE TABLE IF NOT EXISTS "document_templates" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "name" varchar(120) NOT NULL,
    "filename" varchar(200) NOT NULL DEFAULT '',
    "design" jsonb NOT NULL,
    "created_by" bigint,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_templates_list_ix" ON "document_templates" ("tenant_id", "list_id");--> statement-breakpoint
ALTER TABLE "document_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "document_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "document_templates"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint
-- Un PDF que guarda una automatización no tiene persona autora: el archivo
-- queda con `created_by` NULL (el sistema).
ALTER TABLE "attachments" ALTER COLUMN "created_by" DROP NOT NULL;
