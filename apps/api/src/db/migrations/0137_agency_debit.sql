-- v0.1.453 (I3, ADR-S108) — Débito automático de los clientes de una agencia.
--
-- La suscripción vive en la cuenta de Mercado Pago o PayPal de la AGENCIA
-- (ADR-S96), colgada del registro del cliente en «Empresas cliente». Cada
-- cuota cobrada se registra sola como pago de la agencia: este vínculo hace
-- que una cuota se registre UNA sola vez (un aviso repetido no suma dos veces).
ALTER TABLE "agency_payments" ADD COLUMN IF NOT EXISTS "subscription_charge_id" bigint REFERENCES "subscription_charges" ("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agency_payments_sub_charge_ux" ON "agency_payments" ("subscription_charge_id") WHERE "subscription_charge_id" IS NOT NULL;
