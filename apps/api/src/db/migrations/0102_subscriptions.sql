-- v0.1.367 (ADR-S96) — Suscripciones de las empresas a sus clientes (Mercado
-- Pago). La empresa arma planes, el cliente autoriza su tarjeta en la página
-- de Mercado Pago y desde ahí se cobra solo cada período. La app lleva su
-- propio estado (al día / reintentando / en mora / vencida…) a partir de lo
-- que dice Mercado Pago y de los días de gracia del plan.

CREATE TABLE IF NOT EXISTS "subscription_plans" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    -- Borrar la conexión no borra los planes ni el historial.
    "connection_id" bigint REFERENCES "connections" ("id") ON DELETE SET NULL,
    "provider" varchar(24) NOT NULL,
    "name" varchar(120) NOT NULL,
    "description" text,
    "amount" numeric(14, 2) NOT NULL,
    "currency" varchar(8) NOT NULL,
    "frequency" integer NOT NULL DEFAULT 1,
    "frequency_type" varchar(8) NOT NULL DEFAULT 'months',
    "cycles" integer,
    "trial_days" integer NOT NULL DEFAULT 0,
    "grace_days" integer NOT NULL DEFAULT 10,
    "on_expire" varchar(12) NOT NULL DEFAULT 'mark',
    "active" boolean NOT NULL DEFAULT true,
    "created_by" bigint,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_plans_tenant_ix" ON "subscription_plans" ("tenant_id", "connection_id");--> statement-breakpoint
ALTER TABLE "subscription_plans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscription_plans" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "subscription_plans"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "subscription_plans" TO imagina_app;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "subscriptions" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "connection_id" bigint REFERENCES "connections" ("id") ON DELETE SET NULL,
    "provider" varchar(24) NOT NULL,
    "plan_id" bigint REFERENCES "subscription_plans" ("id") ON DELETE SET NULL,
    -- Borrar el registro NO borra la suscripción: en Mercado Pago sigue
    -- cobrando, así que queda a la vista (en la conexión) para cancelarla.
    "list_id" bigint REFERENCES "lists" ("id") ON DELETE SET NULL,
    "record_id" bigint REFERENCES "records" ("id") ON DELETE SET NULL,
    "external_id" varchar(128),
    "reference" varchar(64) NOT NULL,
    "url" text,
    "title" varchar(200) NOT NULL,
    "plan_name" varchar(120),
    "amount" numeric(14, 2) NOT NULL,
    "currency" varchar(8) NOT NULL,
    "frequency" integer NOT NULL DEFAULT 1,
    "frequency_type" varchar(8) NOT NULL DEFAULT 'months',
    "cycles" integer,
    "grace_days" integer NOT NULL DEFAULT 10,
    "on_expire" varchar(12) NOT NULL DEFAULT 'mark',
    "payer_email" varchar(254),
    "status" varchar(16) NOT NULL DEFAULT 'pending',
    "provider_status" varchar(16),
    "start_at" timestamptz,
    "next_charge_at" timestamptz,
    "paid_until" timestamptz,
    "charges_paid" integer NOT NULL DEFAULT 0,
    "charges_failed" integer NOT NULL DEFAULT 0,
    "consecutive_failed" integer NOT NULL DEFAULT 0,
    "retrying" boolean NOT NULL DEFAULT false,
    "failed_final" boolean NOT NULL DEFAULT false,
    "last_charge_at" timestamptz,
    "last_charge_status" varchar(16),
    "last_failure_reason" text,
    "cancelled_at" timestamptz,
    "cancel_reason" text,
    "form_id" bigint,
    "created_by" bigint,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    "last_checked_at" timestamptz
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_reference_ux" ON "subscriptions" ("reference");--> statement-breakpoint
-- Por empresa: migrar una empresa trae la misma suscripción de Mercado Pago.
CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_external_ux" ON "subscriptions" ("tenant_id", "provider", "external_id") WHERE "external_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_record_ix" ON "subscriptions" ("tenant_id", "record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_connection_ix" ON "subscriptions" ("tenant_id", "connection_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_plan_ix" ON "subscriptions" ("plan_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscriptions_list_ix" ON "subscriptions" ("list_id");--> statement-breakpoint
-- La revisión periódica recorre las vivas por la última vez que se miraron.
CREATE INDEX IF NOT EXISTS "subscriptions_check_ix" ON "subscriptions" ("status", "last_checked_at") WHERE "status" NOT IN ('cancelled', 'finished');--> statement-breakpoint
ALTER TABLE "subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "subscriptions"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "subscriptions" TO imagina_app;--> statement-breakpoint

-- Un cobro (cada intento): el MISMO pago llega por dos avisos de Mercado Pago
-- (`payment` y `subscription_authorized_payment`) y tiene que caer en la misma fila.
CREATE TABLE IF NOT EXISTS "subscription_charges" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "subscription_id" bigint NOT NULL REFERENCES "subscriptions" ("id") ON DELETE CASCADE,
    "provider" varchar(24) NOT NULL,
    "provider_payment_id" varchar(128) NOT NULL,
    "invoice_id" varchar(128),
    "amount" numeric(14, 2) NOT NULL,
    "currency" varchar(8) NOT NULL,
    "status" varchar(16) NOT NULL,
    "attempt" integer,
    "failure_reason" text,
    "method" varchar(64),
    "period_start" timestamptz,
    "paid_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_charges_payment_ux" ON "subscription_charges" ("subscription_id", "provider_payment_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subscription_charges_tenant_ix" ON "subscription_charges" ("tenant_id", "created_at");--> statement-breakpoint
ALTER TABLE "subscription_charges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "subscription_charges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "subscription_charges"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "subscription_charges" TO imagina_app;
