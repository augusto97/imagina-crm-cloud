-- v0.1.275 (ADR-S39) — Formularios públicos: una puerta de entrada a una
-- lista. Quien lo completa (sin cuenta) crea un registro. El token es la
-- dirección pública y se busca ANTES de conocer la empresa (conexión base).
CREATE TABLE IF NOT EXISTS "forms" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "name" varchar(120) NOT NULL,
    "token" varchar(64) NOT NULL,
    "enabled" boolean NOT NULL DEFAULT false,
    "config" jsonb NOT NULL,
    "submissions_count" integer NOT NULL DEFAULT 0,
    "last_submitted_at" timestamptz,
    "created_by" bigint,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forms_list_ix" ON "forms" ("tenant_id", "list_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "forms_token_ux" ON "forms" ("token");--> statement-breakpoint
ALTER TABLE "forms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "forms" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "forms"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
