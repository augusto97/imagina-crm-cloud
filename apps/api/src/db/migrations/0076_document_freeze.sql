-- v0.1.290 (ADR-S35 fase 3) — Documentos CONGELADOS al emitirlos y
-- «Anular y emitir de nuevo».
--
-- Un número emitido puede guardar el PDF que salió en ese momento (un
-- archivo del módulo de archivos, en el almacenamiento que eligió la empresa)
-- y desde ahí se entrega siempre ése. Anular un número lo marca (conserva su
-- archivo y su número, que no se reusa) y deja al registro libre para emitir
-- el siguiente con los datos actuales.
ALTER TABLE "document_numbers" ADD COLUMN IF NOT EXISTS "file_id" bigint REFERENCES "attachments" ("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "document_numbers" ADD COLUMN IF NOT EXISTS "frozen_at" timestamptz;--> statement-breakpoint
ALTER TABLE "document_numbers" ADD COLUMN IF NOT EXISTS "frozen_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "document_numbers" ADD COLUMN IF NOT EXISTS "voided_at" timestamptz;--> statement-breakpoint
ALTER TABLE "document_numbers" ADD COLUMN IF NOT EXISTS "voided_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "document_numbers" ADD COLUMN IF NOT EXISTS "void_reason" varchar(300);--> statement-breakpoint
-- Un registro tiene UN número vigente por plantilla; los anulados quedan como
-- historia (antes la unicidad era sobre todos los números del registro).
ALTER TABLE "document_numbers" DROP CONSTRAINT IF EXISTS "document_numbers_record_uq";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "document_numbers_record_active_uq" ON "document_numbers" ("template_id", "record_id") WHERE "voided_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "document_numbers_file_ix" ON "document_numbers" ("file_id") WHERE "file_id" IS NOT NULL;
