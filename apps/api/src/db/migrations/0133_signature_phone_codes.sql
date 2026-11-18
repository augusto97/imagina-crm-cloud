-- v0.1.448 (D6, ADR-S107) — Código de firma por SMS o WhatsApp.
--
-- Cada persona puede tener su celular y la solicitud guarda por qué conexión
-- (SMS o WhatsApp del equipo) sale el código; con WhatsApp de Meta, la
-- plantilla aprobada (`verify_options.template`). Borrar la conexión no borra
-- la solicitud: el código deja de poder salir y la página lo dice.
ALTER TABLE "signature_signers" ADD COLUMN IF NOT EXISTS "phone" varchar(32) NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE "signature_requests" ADD COLUMN IF NOT EXISTS "verify_connection_id" bigint REFERENCES "connections"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "signature_requests" ADD COLUMN IF NOT EXISTS "verify_options" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_requests_verify_conn_ix" ON "signature_requests" ("verify_connection_id") WHERE "verify_connection_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "signature_requests" DROP CONSTRAINT IF EXISTS "signature_requests_verify_ck";--> statement-breakpoint
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_verify_ck" CHECK ("verify" IN ('email', 'sms', 'whatsapp', 'none'));
