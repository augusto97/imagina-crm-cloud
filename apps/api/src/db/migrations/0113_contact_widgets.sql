-- v0.1.394 (ADR-S99) — Widget de contacto: un botón (o barra) que la empresa
-- pega en su sitio con botones de WhatsApp, formularios, agenda, llamar,
-- correo y enlaces. Es de la EMPRESA (no de una lista): un mismo widget abre
-- el formulario de una lista y la agenda de otra. El token es la dirección
-- pública y se busca ANTES de conocer la empresa (conexión base), como el
-- de los formularios.
CREATE TABLE IF NOT EXISTS "contact_widgets" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "name" varchar(120) NOT NULL,
    "token" varchar(64) NOT NULL,
    "enabled" boolean NOT NULL DEFAULT false,
    "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_by" bigint,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "contact_widgets_tenant_ix" ON "contact_widgets" ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "contact_widgets_token_ux" ON "contact_widgets" ("token");--> statement-breakpoint
ALTER TABLE "contact_widgets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "contact_widgets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "contact_widgets"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "contact_widgets" TO imagina_app;
