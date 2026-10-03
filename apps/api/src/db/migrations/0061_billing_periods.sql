-- v0.1.250 — Cobro de planes con período pagado y renovación automática.
--
-- Hasta acá un pago aprobado dejaba a la empresa "activa" SIN fecha: pagaba
-- una vez y quedaba activa para siempre. Ahora cada pago aprobado EXTIENDE
-- `paid_until` y, vencido ese período más unos días de gracia, la empresa pasa
-- a solo-lectura (ADR-S09). `subscription_ends_at` sigue siendo la fecha
-- MANUAL del operador (corte exacto, sin gracia).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "paid_until" timestamptz;--> statement-breakpoint

-- Cada pago del proveedor, UNA fila: el UNIQUE (provider, external_id) es lo
-- que hace idempotente el aviso (Mercado Pago y PayPal reintentan, y el mismo
-- cobro de una suscripción llega por dos caminos).
CREATE TABLE IF NOT EXISTS "billing_payments" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "provider" varchar(24) NOT NULL,
    "external_id" varchar(128) NOT NULL,
    "kind" varchar(16) NOT NULL,
    "plan" varchar(32) NOT NULL,
    "months" integer NOT NULL DEFAULT 1,
    "amount" numeric(14, 2) NOT NULL DEFAULT 0,
    "currency" varchar(8) NOT NULL,
    "status" varchar(16) NOT NULL,
    "method" varchar(64),
    "period_end" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_payments_external_ux" ON "billing_payments" ("provider", "external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_payments_tenant_ix" ON "billing_payments" ("tenant_id", "created_at" DESC);--> statement-breakpoint
ALTER TABLE "billing_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "billing_payments"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "billing_payments" TO imagina_app;--> statement-breakpoint

-- La renovación automática de una empresa (una a la vez: la última manda).
CREATE TABLE IF NOT EXISTS "billing_subscriptions" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "provider" varchar(24) NOT NULL,
    "external_id" varchar(128) NOT NULL,
    "plan" varchar(32) NOT NULL,
    "status" varchar(16) NOT NULL,
    "amount" numeric(14, 2) NOT NULL DEFAULT 0,
    "currency" varchar(8) NOT NULL,
    "next_payment_at" timestamptz,
    "authorize_url" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "billing_subscriptions_external_ux" ON "billing_subscriptions" ("provider", "external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_subscriptions_tenant_ix" ON "billing_subscriptions" ("tenant_id", "updated_at" DESC);--> statement-breakpoint
ALTER TABLE "billing_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "billing_subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "billing_subscriptions"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "billing_subscriptions" TO imagina_app;
