-- v0.1.118 — Verificación de email en el alta pública.
--
-- El registro creaba la cuenta y listo: cualquiera podía dar de alta cuentas
-- con emails ajenos o inexistentes (spam, y el email es la identidad que usan
-- los magic links y las invitaciones).
--
-- Nota de diseño: NO se bloquea el uso de la app sin verificar (eso mata la
-- activación). Se marca la cuenta y se avisa en la interfaz; las acciones que
-- MANDAN correo en nombre del usuario son las que conviene gatear.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "email_verified_at" timestamptz;--> statement-breakpoint

-- Las cuentas que YA existían son anteriores a esta función: se dan por
-- verificadas (grandfathering). Si no, todos los usuarios en producción verían
-- el aviso de "confirmá tu email" por un correo que jamás recibieron.
UPDATE "users" SET "email_verified_at" = "created_at" WHERE "email_verified_at" IS NULL;
