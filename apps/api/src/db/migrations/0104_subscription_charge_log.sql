-- v0.1.371 (ADR-S96) — Registro de cobros: cada cobro de una suscripción queda
-- como un registro en la lista que elija la empresa. Se recuerda en qué lista
-- y en qué registro quedó (para no duplicarlo y para actualizarlo si cambia:
-- un reembolso, el medio de pago que llegó después).

ALTER TABLE "subscription_charges" ADD COLUMN IF NOT EXISTS "log_list_id" bigint;
ALTER TABLE "subscription_charges" ADD COLUMN IF NOT EXISTS "log_record_id" bigint;
ALTER TABLE "subscription_charges" ADD COLUMN IF NOT EXISTS "logged_at" timestamptz;
