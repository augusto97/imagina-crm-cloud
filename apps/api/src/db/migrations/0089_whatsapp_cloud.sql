-- D3 — WhatsApp oficial (Meta WhatsApp Cloud API).
--
-- La app NO guarda la conversación: el texto del último mensaje queda en las
-- columnas de la lista (`lists.settings.whatsapp`). Aquí sólo vive lo que el
-- canal necesita para funcionar: dónde llegan los avisos de Meta, la copia de
-- las plantillas aprobadas y, por contacto, cuándo escribió por última vez (la
-- ventana de 24 h) y el id del último envío (para atar su estado al registro).

-- Token de la URL de avisos de cada conexión. SIN RLS (como collection_hooks):
-- el aviso de Meta llega antes de saber de qué empresa es. `verify_token` es lo
-- que Meta repite en la verificación GET (hub.verify_token).
CREATE TABLE IF NOT EXISTS "whatsapp_hooks" (
    "token" varchar(64) PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "connection_id" bigint NOT NULL REFERENCES "connections" ("id") ON DELETE CASCADE,
    "verify_token" varchar(64) NOT NULL,
    "last_hook_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_hooks_connection_ux" ON "whatsapp_hooks" ("connection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_hooks_tenant_ix" ON "whatsapp_hooks" ("tenant_id");--> statement-breakpoint

-- Copia de las plantillas de la cuenta (las crea y aprueba Meta; aquí se leen).
CREATE TABLE IF NOT EXISTS "whatsapp_templates" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "connection_id" bigint NOT NULL REFERENCES "connections" ("id") ON DELETE CASCADE,
    "meta_id" varchar(64) NOT NULL DEFAULT '',
    "name" varchar(512) NOT NULL,
    "language" varchar(16) NOT NULL,
    "category" varchar(32) NOT NULL DEFAULT '',
    "status" varchar(32) NOT NULL DEFAULT '',
    "parameter_format" varchar(16) NOT NULL DEFAULT 'POSITIONAL',
    "components" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "rejected_reason" text,
    "synced_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "whatsapp_templates_name_ux" UNIQUE ("connection_id", "name", "language")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_templates_tenant_ix" ON "whatsapp_templates" ("tenant_id");--> statement-breakpoint
ALTER TABLE "whatsapp_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "whatsapp_templates"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "whatsapp_templates" TO imagina_app;--> statement-breakpoint

-- Un contacto por (conexión, número): la ventana de 24 h y el último envío.
-- Sin texto de mensajes.
CREATE TABLE IF NOT EXISTS "whatsapp_contacts" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "connection_id" bigint NOT NULL REFERENCES "connections" ("id") ON DELETE CASCADE,
    "phone" varchar(20) NOT NULL,
    "profile_name" varchar(200),
    "last_inbound_at" timestamptz,
    "last_outbound_at" timestamptz,
    "last_outbound_wamid" varchar(160),
    "last_outbound_status" varchar(16),
    "last_outbound_error" text,
    "last_outbound_list_id" bigint REFERENCES "lists" ("id") ON DELETE SET NULL,
    "last_outbound_record_id" bigint REFERENCES "records" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "whatsapp_contacts_phone_ux" UNIQUE ("connection_id", "phone")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_contacts_tenant_ix" ON "whatsapp_contacts" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_contacts_wamid_ix" ON "whatsapp_contacts" ("connection_id", "last_outbound_wamid");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_contacts_record_ix" ON "whatsapp_contacts" ("last_outbound_record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whatsapp_contacts_list_ix" ON "whatsapp_contacts" ("last_outbound_list_id");--> statement-breakpoint
ALTER TABLE "whatsapp_contacts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whatsapp_contacts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "whatsapp_contacts"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "whatsapp_contacts" TO imagina_app;
