-- v0.1.452 (I3, ADR-S108) — La agencia cobra en línea a sus clientes.
--
-- `agency_record_id`: el registro de la empresa CLIENTE en la lista «Empresas
-- cliente» de su agencia (donde cuelgan los links de pago). Sin FK a
-- `records` a propósito: si el registro se borra, la próxima sincronización
-- arma uno nuevo.
--
-- `agency_charges`: cada cobro en línea (un link de pago por N meses del
-- plan). Al entrar el pago, se registra solo en `agency_payments` y corre el
-- «pagado hasta». Datos de la AGENCIA (RLS por `tenant_id` = agencia).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "agency_record_id" bigint;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agency_charges" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "client_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "link_id" bigint REFERENCES "payment_links" ("id") ON DELETE SET NULL,
    "months" integer NOT NULL,
    "amount" numeric(16, 2) NOT NULL,
    "currency" varchar(8) NOT NULL,
    "status" varchar(16) NOT NULL DEFAULT 'pending',
    "via" varchar(16) NOT NULL DEFAULT 'agency',
    "payment_id" bigint REFERENCES "agency_payments" ("id") ON DELETE SET NULL,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "paid_at" timestamptz,
    CONSTRAINT "agency_charges_months_ck" CHECK ("months" BETWEEN 1 AND 36),
    CONSTRAINT "agency_charges_amount_ck" CHECK ("amount" > 0),
    CONSTRAINT "agency_charges_status_ck" CHECK ("status" IN ('pending', 'paid', 'expired', 'cancelled'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agency_charges_client_ix" ON "agency_charges" ("tenant_id", "client_id", "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agency_charges_client_fk_ix" ON "agency_charges" ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "agency_charges_link_ux" ON "agency_charges" ("link_id") WHERE "link_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agency_charges_payment_ix" ON "agency_charges" ("payment_id") WHERE "payment_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agency_charges_created_by_ix" ON "agency_charges" ("created_by") WHERE "created_by" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "agency_charges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agency_charges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "agency_charges"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "agency_charges" TO imagina_app;
