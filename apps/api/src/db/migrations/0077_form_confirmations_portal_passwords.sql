-- v0.1.290 — Respuestas de formularios que esperan que la persona confirme su
-- correo (doble opt-in). Guarda la respuesta YA validada; el registro se crea
-- recién al abrir el enlace del correo. Con RLS (son datos personales de la
-- empresa); el enlace público la busca por el HASH del token con la conexión
-- base, igual que `forms.token` (el token en claro sólo viaja en el correo).
CREATE TABLE IF NOT EXISTS "form_pending_submissions" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "form_id" bigint NOT NULL REFERENCES "forms" ("id") ON DELETE CASCADE,
    "token_hash" varchar(64) NOT NULL,
    "email" varchar(320) NOT NULL,
    "data" jsonb NOT NULL,
    "attachment_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "ip" varchar(64),
    "expires_at" timestamptz NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "form_pending_token_ux" ON "form_pending_submissions" ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_pending_expires_ix" ON "form_pending_submissions" ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_pending_form_ix" ON "form_pending_submissions" ("tenant_id", "form_id");--> statement-breakpoint
ALTER TABLE "form_pending_submissions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_pending_submissions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "form_pending_submissions"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint
-- v0.1.290 — Contraseña del PORTAL del cliente, por empresa. NO es la
-- contraseña de la cuenta (`users.password_hash`): un cliente de dos empresas
-- tiene dos contraseñas independientes y ninguna sirve para la app del equipo.
CREATE TABLE IF NOT EXISTS "portal_credentials" (
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "user_id" bigint NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
    "password_hash" varchar(255) NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("tenant_id", "user_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_credentials_user_ix" ON "portal_credentials" ("user_id");--> statement-breakpoint
ALTER TABLE "portal_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portal_credentials" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "portal_credentials"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
