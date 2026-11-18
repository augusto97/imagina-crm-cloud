-- v0.1.447 (D6, ADR-S107) — Verificar un documento firmado subiendo el PDF.
--
-- La página pública calcula la huella SHA-256 en el navegador (el archivo no
-- viaja) y pregunta de qué firma es: búsqueda por huella del PDF firmado o del
-- original, en todo el servidor.
CREATE INDEX IF NOT EXISTS "signature_requests_original_sha_ix" ON "signature_requests" ("original_sha256");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signature_requests_signed_sha_ix" ON "signature_requests" ("signed_sha256") WHERE "signed_sha256" IS NOT NULL;
