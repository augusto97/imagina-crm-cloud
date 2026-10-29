-- v0.1.332 (ADR-S82) — SMS con la cuenta de cada empresa.
--
-- La app NO guarda conversaciones: en el registro quedan cuándo salió el último
-- SMS y cómo terminó (columnas de `lists.settings.sms`). Aquí vive lo que el
-- canal necesita: la URL de los avisos de entrega de cada conexión y, por cada
-- SMS que sale, a quién, cuántas partes, su estado y el id del proveedor. El
-- texto se guarda sólo mientras el mensaje espera (programado por el horario de
-- la Ley 2300 o en la cola de un envío masivo) y se borra al mandarse.

-- Token de la URL de avisos de cada conexión. SIN RLS (como whatsapp_hooks):
-- el aviso del proveedor llega antes de saber de qué empresa es.
CREATE TABLE IF NOT EXISTS "sms_hooks" (
    "token" varchar(64) PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "connection_id" bigint NOT NULL REFERENCES "connections" ("id") ON DELETE CASCADE,
    "last_hook_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sms_hooks_connection_ux" ON "sms_hooks" ("connection_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_hooks_tenant_ix" ON "sms_hooks" ("tenant_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "sms_messages" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "connection_id" bigint REFERENCES "connections" ("id") ON DELETE SET NULL,
    "provider" varchar(32) NOT NULL,
    "list_id" bigint REFERENCES "lists" ("id") ON DELETE SET NULL,
    "record_id" bigint REFERENCES "records" ("id") ON DELETE SET NULL,
    "user_id" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "source" varchar(16) NOT NULL,
    "batch_id" varchar(32),
    "automation_id" bigint,
    "to_phone" varchar(24) NOT NULL,
    "body" text,
    "sender" varchar(32),
    "segments" integer NOT NULL DEFAULT 1,
    "encoding" varchar(8) NOT NULL DEFAULT 'gsm7',
    "status" varchar(16) NOT NULL,
    "error" text,
    "provider_message_id" varchar(160),
    "reference" varchar(32) NOT NULL,
    "respect_hours" boolean NOT NULL DEFAULT false,
    "send_after" timestamptz,
    "claimed_at" timestamptz,
    "attempts" integer NOT NULL DEFAULT 0,
    "sent_at" timestamptz,
    "delivered_at" timestamptz,
    "next_poll_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_tenant_ix" ON "sms_messages" ("tenant_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_connection_ix" ON "sms_messages" ("connection_id", "created_at");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sms_messages_provider_id_ux" ON "sms_messages" ("connection_id", "provider_message_id") WHERE "provider_message_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "sms_messages_reference_ux" ON "sms_messages" ("reference");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_pending_ix" ON "sms_messages" ("status", "send_after") WHERE "status" IN ('programado', 'en_cola', 'enviando');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_poll_ix" ON "sms_messages" ("next_poll_at") WHERE "next_poll_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_record_ix" ON "sms_messages" ("record_id", "id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_list_ix" ON "sms_messages" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_batch_ix" ON "sms_messages" ("tenant_id", "batch_id") WHERE "batch_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_user_ix" ON "sms_messages" ("user_id");--> statement-breakpoint
ALTER TABLE "sms_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sms_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sms_messages"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sms_messages" TO imagina_app;
