-- v0.1.240 — Invitaciones a una empresa.
--
-- Una cuenta creada por invitación (el admin de una empresa o el operador
-- escriben el email de alguien que todavía no tiene cuenta) nace con una
-- contraseña aleatoria que nadie conoce: la persona entra recién cuando abre
-- el enlace del correo y define la suya. `invited_at` marca ese estado
-- PENDIENTE —para mostrar "Invitación pendiente" y ofrecer "Reenviar"— y se
-- limpia al definir la contraseña. NULL = la cuenta ya tiene contraseña propia.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invited_at" timestamptz;
