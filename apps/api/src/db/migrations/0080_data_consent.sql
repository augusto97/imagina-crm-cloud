-- Autorización de tratamiento de datos personales (Ley 1581 de 2012, Decreto
-- 1377 de 2013 compilado en el Decreto 1074 de 2015).
--
-- `data_consent_versions`: cada cambio del texto YA ARMADO de la empresa es una
-- versión numerada (por empresa). Lo que una persona aceptó no cambia aunque
-- la empresa edite el texto después: la autorización apunta a SU versión.
CREATE TABLE IF NOT EXISTS "data_consent_versions" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "version" integer NOT NULL,
    "text" text NOT NULL,
    "checkbox_label" varchar(1000) NOT NULL,
    "policy_url" varchar(500),
    "text_hash" varchar(64) NOT NULL,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "data_consent_versions_ux" ON "data_consent_versions" ("tenant_id", "version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_consent_versions_created_by_ix" ON "data_consent_versions" ("created_by");--> statement-breakpoint
ALTER TABLE "data_consent_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "data_consent_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "data_consent_versions"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "data_consent_versions" TO imagina_app;--> statement-breakpoint

-- `data_consents`: la EVIDENCIA de cada autorización (el responsable conserva
-- la prueba). Quién (snapshot del correo y el nombre: sigue legible si el
-- registro o la cuenta se borran), qué versión y con qué hash, cuándo, IP y
-- navegador, desde qué formulario o el portal; y, si la retiró, cuándo, por
-- qué vía y desde dónde. Las referencias a formulario, lista, registro y
-- persona quedan en NULL si esos objetos se borran: la prueba no se pierde.
--
-- `withdraw_ref`: referencia aleatoria del enlace de un solo propósito para
-- retirar la autorización (viaja en el correo de confirmación/copia). El
-- enlace es `<empresa>.<ref>.<firma HMAC>`: con sólo lo guardado aquí no se
-- puede armar un enlace válido (la firma exige el secreto del servidor), y el
-- servidor sí puede volver a armarlo para un correo posterior.
CREATE TABLE IF NOT EXISTS "data_consents" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "version" integer NOT NULL,
    "text_hash" varchar(64) NOT NULL,
    "source" varchar(12) NOT NULL,
    "source_label" varchar(300) NOT NULL DEFAULT '',
    "form_id" bigint REFERENCES "forms" ("id") ON DELETE SET NULL,
    "list_id" bigint REFERENCES "lists" ("id") ON DELETE SET NULL,
    "record_id" bigint REFERENCES "records" ("id") ON DELETE SET NULL,
    "user_id" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "subject_email" varchar(320),
    "subject_name" varchar(300),
    "accepted_at" timestamptz NOT NULL,
    "ip" varchar(64),
    "user_agent" varchar(400),
    "withdraw_ref" varchar(40),
    "withdrawn_at" timestamptz,
    "withdrawn_via" varchar(12),
    "withdrawn_ip" varchar(64),
    "withdrawn_user_agent" varchar(400),
    "withdrawn_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "withdrawn_note" varchar(500),
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "data_consents_version_fk" FOREIGN KEY ("tenant_id", "version")
        REFERENCES "data_consent_versions" ("tenant_id", "version")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_consents_tenant_ix" ON "data_consents" ("tenant_id", "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_consents_version_ix" ON "data_consents" ("tenant_id", "version");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_consents_record_ix" ON "data_consents" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_consents_user_ix" ON "data_consents" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_consents_form_ix" ON "data_consents" ("form_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_consents_list_ix" ON "data_consents" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_consents_withdrawn_by_ix" ON "data_consents" ("withdrawn_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "data_consents_email_ix" ON "data_consents" ("tenant_id", lower("subject_email"));--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "data_consents_withdraw_ux" ON "data_consents" ("tenant_id", "withdraw_ref") WHERE "withdraw_ref" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "data_consents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "data_consents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "data_consents"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "data_consents" TO imagina_app;--> statement-breakpoint

-- Una respuesta de formulario que espera la confirmación del correo (v0.1.289)
-- guarda la autorización que se aceptó al ENVIAR (versión, cuándo, IP,
-- navegador y la referencia del enlace de retiro): se registra al confirmar,
-- con los datos del envío original.
ALTER TABLE "form_pending_submissions" ADD COLUMN IF NOT EXISTS "consent" jsonb;
