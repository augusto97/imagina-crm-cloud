-- D2 + E5 — Mesa de ayuda por correo + SLA y escalamiento.
--
-- `helpdesk_mailboxes`: el BUZÓN de soporte de una lista (uno por lista),
-- leído por IMAP con usuario + contraseña de aplicación. La contraseña va
-- cifrada (secret-box con SECRETS_KEY, como el SMTP de la empresa) y nunca
-- vuelve al cliente. `state` lleva el cursor (UIDVALIDITY + último UID
-- procesado): no se borra ni se marca nada en el buzón salvo que se pida.
CREATE TABLE IF NOT EXISTS "helpdesk_mailboxes" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "preset" varchar(16) NOT NULL DEFAULT 'generic',
    "host" varchar(255) NOT NULL,
    "port" integer NOT NULL,
    "security" varchar(16) NOT NULL DEFAULT 'tls',
    "username" varchar(255) NOT NULL,
    "password_enc" text,
    "folder" varchar(255) NOT NULL DEFAULT 'INBOX',
    "support_address" varchar(255) NOT NULL,
    "mark_seen" boolean NOT NULL DEFAULT false,
    "allow_invalid_cert" boolean NOT NULL DEFAULT false,
    "enabled" boolean NOT NULL DEFAULT true,
    "state" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "next_check_at" timestamptz,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "helpdesk_mailboxes_list_ux" UNIQUE ("list_id"),
    CONSTRAINT "helpdesk_mailboxes_security_ck" CHECK ("security" IN ('tls', 'starttls', 'none'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "helpdesk_mailboxes_due_ix" ON "helpdesk_mailboxes" ("next_check_at") WHERE "enabled";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "helpdesk_mailboxes_tenant_ix" ON "helpdesk_mailboxes" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "helpdesk_mailboxes_created_by_ix" ON "helpdesk_mailboxes" ("created_by");--> statement-breakpoint
ALTER TABLE "helpdesk_mailboxes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "helpdesk_mailboxes" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "helpdesk_mailboxes"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "helpdesk_mailboxes" TO imagina_app;--> statement-breakpoint

-- `helpdesk_messages`: cada correo que entró (y lo que se hizo con él) o que
-- salió desde la ficha. Los Message-ID son la base del hilo: una respuesta
-- del cliente se reconoce por `In-Reply-To` / `References` contra estos ids.
-- Se guarda la metadata (de, para, asunto), no el cuerpo: el cuerpo vive en
-- la descripción del ticket o en el comentario.
CREATE TABLE IF NOT EXISTS "helpdesk_messages" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "mailbox_id" bigint REFERENCES "helpdesk_mailboxes" ("id") ON DELETE SET NULL,
    "record_id" bigint REFERENCES "records" ("id") ON DELETE CASCADE,
    "comment_id" bigint REFERENCES "comments" ("id") ON DELETE SET NULL,
    "direction" varchar(4) NOT NULL,
    "status" varchar(16) NOT NULL,
    "reason" text,
    "message_id" varchar(500),
    "in_reply_to" varchar(500),
    "refs" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "from_email" varchar(320),
    "from_name" varchar(255),
    "to_addr" text,
    "cc_addr" text,
    "subject" varchar(500),
    "uid" bigint,
    "uidvalidity" bigint,
    "sent_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "helpdesk_messages_direction_ck" CHECK ("direction" IN ('in', 'out'))
);--> statement-breakpoint
-- Un mismo correo no se procesa dos veces (dos nodos, un reintento).
CREATE UNIQUE INDEX IF NOT EXISTS "helpdesk_messages_inbound_ux" ON "helpdesk_messages" ("mailbox_id", "message_id")
    WHERE "direction" = 'in' AND "message_id" IS NOT NULL;--> statement-breakpoint
-- El hilo: buscar por Message-ID dentro de la lista.
CREATE INDEX IF NOT EXISTS "helpdesk_messages_thread_ix" ON "helpdesk_messages" ("tenant_id", "list_id", "message_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "helpdesk_messages_record_ix" ON "helpdesk_messages" ("record_id", "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "helpdesk_messages_mailbox_ix" ON "helpdesk_messages" ("mailbox_id", "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "helpdesk_messages_list_ix" ON "helpdesk_messages" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "helpdesk_messages_comment_ix" ON "helpdesk_messages" ("comment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "helpdesk_messages_sent_by_ix" ON "helpdesk_messages" ("sent_by");--> statement-breakpoint
ALTER TABLE "helpdesk_messages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "helpdesk_messages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "helpdesk_messages"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "helpdesk_messages" TO imagina_app;--> statement-breakpoint

-- `helpdesk_tickets`: el estado de mesa de ayuda de un registro — quién es el
-- cliente, el asunto del hilo y el RELOJ del SLA (cuándo empezó, los
-- objetivos de su prioridad, primera respuesta, resolución, pausas) con lo
-- ya calculado (vencimientos y estado) para que el planificador encuentre
-- por índice lo que cambia de estado (`next_check_at`). `alerts` es el
-- registro de avisos ya enviados: un aviso por ticket y por umbral.
CREATE TABLE IF NOT EXISTS "helpdesk_tickets" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "mailbox_id" bigint REFERENCES "helpdesk_mailboxes" ("id") ON DELETE SET NULL,
    "customer_email" varchar(320),
    "customer_name" varchar(255),
    "subject" varchar(500),
    "started_at" timestamptz NOT NULL DEFAULT now(),
    "priority" varchar(190),
    "first_response_minutes" integer,
    "resolution_minutes" integer,
    "first_response_at" timestamptz,
    "resolved_at" timestamptz,
    "pauses" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "sla_status" varchar(16),
    "first_response_due" timestamptz,
    "resolution_due" timestamptz,
    "alerts" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "next_check_at" timestamptz,
    "last_inbound_at" timestamptz,
    "last_outbound_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "helpdesk_tickets_record_ux" UNIQUE ("record_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "helpdesk_tickets_due_ix" ON "helpdesk_tickets" ("next_check_at") WHERE "next_check_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "helpdesk_tickets_list_ix" ON "helpdesk_tickets" ("tenant_id", "list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "helpdesk_tickets_list_fk_ix" ON "helpdesk_tickets" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "helpdesk_tickets_mailbox_ix" ON "helpdesk_tickets" ("mailbox_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "helpdesk_tickets_customer_ix" ON "helpdesk_tickets" ("tenant_id", "list_id", lower("customer_email"));--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "helpdesk_tickets"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "helpdesk_tickets" TO imagina_app;
