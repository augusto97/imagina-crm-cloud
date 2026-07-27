-- v0.1.120 — Verificación en dos pasos (TOTP) por cuenta.
--
-- El secreto se guarda CIFRADO en reposo (secret-box AES-256-GCM con
-- `SECRETS_KEY`, obligatoria en producción desde v0.1.113): quien lea la tabla
-- no puede generar códigos. Los códigos de respaldo se guardan hasheados
-- (SHA-256) — son aleatorios de 50 bits, no hace falta un KDF lento.
--
-- `totp_enabled_at` NULL = el segundo factor no está activo. Un secreto puede
-- existir sin estar habilitado sólo de forma transitoria: el alta guarda el
-- secreto pendiente en Redis y recién persiste acá cuando el usuario confirma
-- un código válido.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_secret" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_enabled_at" timestamptz;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "totp_backup_codes" jsonb;
