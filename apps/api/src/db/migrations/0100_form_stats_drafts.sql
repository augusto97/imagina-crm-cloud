-- v0.1.358 — Formularios: estadísticas y avances guardados.
--
-- `form_stats`: contadores por formulario y por día (en la zona de la
-- empresa): visitas, empezados, enviados, hasta qué paso llegaron, dónde lo
-- dejaron, de dónde vinieron y desde qué dispositivo. Son SUMAS, nunca datos
-- de una persona (no hay IP ni cookies). Las visitas se suman primero en Redis
-- y cada pocos minutos se vuelcan aquí.
--
-- `form_drafts`: lo que una persona fue respondiendo cuando pidió «Guardar y
-- seguir después». El enlace del correo la busca por el HASH del código con la
-- conexión base, igual que las respuestas pendientes. Dura 30 días y se borra
-- al enviar.
CREATE TABLE IF NOT EXISTS "form_stats" (
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "form_id" bigint NOT NULL REFERENCES "forms" ("id") ON DELETE CASCADE,
    "day" date NOT NULL,
    "counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("form_id", "day")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_stats_tenant_ix" ON "form_stats" ("tenant_id", "form_id", "day");--> statement-breakpoint
ALTER TABLE "form_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_stats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "form_stats"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "form_drafts" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "form_id" bigint NOT NULL REFERENCES "forms" ("id") ON DELETE CASCADE,
    "token_hash" varchar(64) NOT NULL,
    "email" varchar(320) NOT NULL,
    "values" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "page" integer NOT NULL DEFAULT 0,
    "expires_at" timestamptz NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "form_drafts_token_ux" ON "form_drafts" ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_drafts_expires_ix" ON "form_drafts" ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "form_drafts_form_ix" ON "form_drafts" ("tenant_id", "form_id");--> statement-breakpoint
ALTER TABLE "form_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "form_drafts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "form_drafts"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
