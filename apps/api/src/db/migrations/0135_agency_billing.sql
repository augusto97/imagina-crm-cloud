-- v0.1.451 (I3, ADR-S108) — La agencia le cobra a sus clientes.
--
-- `agency_paid_until`: hasta cuándo pagó la empresa CLIENTE a su agencia (lo
-- lleva la agencia). Es columna (no `settings`) porque la lee el cálculo del
-- acceso en cada pedido, dentro de la subconsulta de la agencia. La prueba y
-- el período pagado de la PLATAFORMA no cuentan para un cliente de agencia.
--
-- `agency_payments`: los pagos que registra la agencia (a mano por ahora; el
-- cobro en línea los suma después). Son datos de la AGENCIA (RLS por
-- `tenant_id` = agencia); `client_id` es la empresa que pagó.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "agency_paid_until" timestamp with time zone;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agency_payments" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "client_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "amount" numeric(16, 2) NOT NULL,
    "currency" varchar(8) NOT NULL,
    "months" integer NOT NULL,
    "method" varchar(24) NOT NULL,
    "note" varchar(240),
    "paid_on" date NOT NULL,
    "period_from" timestamptz NOT NULL,
    "period_to" timestamptz NOT NULL,
    "prev_paid_until" timestamptz,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "undone_at" timestamptz,
    "undone_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    CONSTRAINT "agency_payments_months_ck" CHECK ("months" BETWEEN 1 AND 36),
    CONSTRAINT "agency_payments_amount_ck" CHECK ("amount" >= 0)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agency_payments_client_ix" ON "agency_payments" ("client_id", "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agency_payments_tenant_ix" ON "agency_payments" ("tenant_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agency_payments_created_by_ix" ON "agency_payments" ("created_by") WHERE "created_by" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agency_payments_undone_by_ix" ON "agency_payments" ("undone_by") WHERE "undone_by" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "agency_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agency_payments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "agency_payments"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "agency_payments" TO imagina_app;
