-- v0.1.446 (D6, ADR-S107) — Firma electrónica de documentos.
--
-- Una solicitud es un PDF de un registro que firman una o varias personas por
-- enlace. El PDF original se guarda como copia propia (su huella SHA-256 es lo
-- que se firma) y, al completarse, el PDF firmado (sellado + constancia). Los
-- dos son adjuntos con RESTRICT: no se borran sueltos.
CREATE TABLE IF NOT EXISTS "signature_requests" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "title" varchar(160) NOT NULL,
    "status" varchar(16) NOT NULL DEFAULT 'pending',
    "order_mode" varchar(16) NOT NULL DEFAULT 'parallel',
    "verify" varchar(16) NOT NULL DEFAULT 'email',
    "message" text NOT NULL DEFAULT '',
    "source" varchar(16) NOT NULL,
    "template_id" bigint REFERENCES "document_templates" ("id") ON DELETE SET NULL,
    "document_number_id" bigint REFERENCES "document_numbers" ("id") ON DELETE SET NULL,
    "document_label" varchar(40),
    "original_file_id" bigint NOT NULL REFERENCES "attachments" ("id") ON DELETE RESTRICT,
    "original_sha256" char(64) NOT NULL,
    "pages" integer NOT NULL DEFAULT 0,
    "signed_file_id" bigint REFERENCES "attachments" ("id") ON DELETE RESTRICT,
    "signed_sha256" char(64),
    "code" varchar(16) NOT NULL,
    "on_complete" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "remind_days" integer NOT NULL DEFAULT 3,
    "expires_at" timestamptz NOT NULL,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    "completed_at" timestamptz,
    "voided_at" timestamptz,
    "voided_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "void_reason" varchar(500),
    "link_version" integer NOT NULL DEFAULT 1,
    CONSTRAINT "signature_requests_status_ck" CHECK ("status" IN ('pending', 'completed', 'declined', 'expired', 'voided')),
    CONSTRAINT "signature_requests_order_ck" CHECK ("order_mode" IN ('parallel', 'sequential')),
    CONSTRAINT "signature_requests_verify_ck" CHECK ("verify" IN ('email', 'none')),
    CONSTRAINT "signature_requests_source_ck" CHECK ("source" IN ('template', 'file'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "signature_requests_code_ux" ON "signature_requests" ("code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_requests_record_ix" ON "signature_requests" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_requests_tenant_ix" ON "signature_requests" ("tenant_id", "record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_requests_list_ix" ON "signature_requests" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_requests_template_ix" ON "signature_requests" ("template_id") WHERE "template_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_requests_number_ix" ON "signature_requests" ("document_number_id") WHERE "document_number_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_requests_original_ix" ON "signature_requests" ("original_file_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_requests_signed_ix" ON "signature_requests" ("signed_file_id") WHERE "signed_file_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_requests_created_by_ix" ON "signature_requests" ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_requests_voided_by_ix" ON "signature_requests" ("voided_by") WHERE "voided_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_requests_pending_ix" ON "signature_requests" ("expires_at") WHERE "status" = 'pending';--> statement-breakpoint
ALTER TABLE "signature_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "signature_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "signature_requests"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "signature_requests" TO imagina_app;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "signature_signers" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "request_id" bigint NOT NULL REFERENCES "signature_requests" ("id") ON DELETE CASCADE,
    "position" integer NOT NULL,
    "name" varchar(120) NOT NULL,
    "email" varchar(255) NOT NULL,
    "role" varchar(60) NOT NULL DEFAULT '',
    "status" varchar(16) NOT NULL DEFAULT 'waiting',
    "sent_at" timestamptz,
    "viewed_at" timestamptz,
    "signed_at" timestamptz,
    "declined_at" timestamptz,
    "decline_reason" text,
    "reminders_sent" integer NOT NULL DEFAULT 0,
    "last_reminded_at" timestamptz,
    "signed_name" varchar(120),
    "signature_kind" varchar(8),
    "signature_png" text,
    "ip" varchar(64),
    "user_agent" varchar(400),
    "verified_by" varchar(16),
    "consent_text" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "signature_signers_status_ck" CHECK ("status" IN ('waiting', 'sent', 'viewed', 'signed', 'declined'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_signers_request_ix" ON "signature_signers" ("request_id", "position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_signers_tenant_ix" ON "signature_signers" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_signers_remind_ix" ON "signature_signers" ("last_reminded_at") WHERE "status" IN ('sent', 'viewed');--> statement-breakpoint
ALTER TABLE "signature_signers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "signature_signers" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "signature_signers"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "signature_signers" TO imagina_app;
