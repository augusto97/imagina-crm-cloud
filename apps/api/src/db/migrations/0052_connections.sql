-- v0.1.196 (ADR-S22) — Conectores: credenciales de servicios externos
-- guardadas UNA vez y referenciadas por ID desde donde se usen.
--
-- Hasta acá el secreto de firma HMAC y las cabeceras de autorización de un
-- webhook viajaban en TEXTO PLANO dentro de `automations.actions[].config`
-- (jsonb). Con N automatizaciones contra el mismo destino había N copias de la
-- misma clave y rotarla era editarlas a mano; por eso el MCP tuvo que aprender
-- a enmascararlas (v0.1.193), que era tapar el síntoma.
--
-- Los secretos van CIFRADOS en `secrets` (secret-box AES-256-GCM, SEC-20,
-- misma `SECRETS_KEY` que el SMTP por empresa y el secreto TOTP). Las claves
-- no secretas (base URL, nombre de cabecera, cabeceras fijas) quedan en claro
-- para poder mostrarlas y buscarlas.
CREATE TABLE IF NOT EXISTS "connections" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "provider" varchar(64) NOT NULL DEFAULT 'http',
    "name" text NOT NULL,
    "base_url" text NOT NULL DEFAULT '',
    "auth_type" varchar(16) NOT NULL DEFAULT 'none',
    "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "secrets" jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- 'workspace' = la usa todo el equipo; 'private' = sólo su dueño, y sólo
    -- si el admin lo habilitó en los ajustes del workspace.
    "visibility" varchar(16) NOT NULL DEFAULT 'workspace',
    "owner_user_id" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "last_check_at" timestamptz,
    "last_check_ok" boolean,
    "last_check_error" text,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "connections" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connections" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "connections"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "connections" TO imagina_app;--> statement-breakpoint

-- El nombre es cómo la elige la persona en un desplegable: dos conexiones que
-- se llaman igual dentro de la misma empresa serían indistinguibles.
CREATE UNIQUE INDEX "connections_tenant_name_ux" ON "connections" ("tenant_id", lower("name"));--> statement-breakpoint
CREATE INDEX "connections_tenant_ix" ON "connections" ("tenant_id", "id");
