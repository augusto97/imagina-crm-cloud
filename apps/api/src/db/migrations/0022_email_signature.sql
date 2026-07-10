-- Firma de email por usuario (endpoints /me/email-signature). Texto libre
-- (HTML permitido, tope 20k validado en el schema Zod); NULL = sin firma.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_signature" text;
