-- v0.1.166 — Plantillas de lista del workspace ("Guardar como plantilla").
--
-- El blueprint es el formato portable de una lista (campos, vistas,
-- automatizaciones, ajustes y registros de muestra) con las referencias
-- internas por slug — el mismo que usa "Duplicar lista". Las plantillas del
-- SISTEMA no están acá: viven en código y se listan junto a éstas.
CREATE TABLE IF NOT EXISTS "list_templates" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id"),
    "name" text NOT NULL,
    "description" text,
    "icon" varchar(64),
    "color" varchar(32),
    "category" varchar(32) NOT NULL DEFAULT 'otros',
    "blueprint" jsonb NOT NULL,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "list_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "list_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "list_templates"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

CREATE INDEX "list_templates_tenant_ix" ON "list_templates" ("tenant_id", "created_at");
