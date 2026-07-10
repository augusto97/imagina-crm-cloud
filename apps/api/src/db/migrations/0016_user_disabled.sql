-- Desactivación de cuentas (consola de operador, ADR-S15 Fase 2). `disabled_at`
-- NULL = activa; con fecha = deshabilitada (login rechazado + sesiones revocadas).
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "disabled_at" timestamptz;
