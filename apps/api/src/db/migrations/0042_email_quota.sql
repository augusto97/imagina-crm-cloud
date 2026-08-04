-- v0.1.152 (ADR-S18) — Cuota mensual de correos enviados POR EL SMTP DE LA
-- PLATAFORMA. Sin esto una empresa puede usar la app como plataforma de
-- mailing: el costo del envío y la reputación del dominio remitente los paga
-- el operador. Con SMTP propio configurado NO hay cuota — esos correos salen
-- por el servidor del cliente y no cuestan nada acá.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "max_emails_month" integer;--> statement-breakpoint

-- Semilla de los built-in (NULL = ilimitado, igual que el resto de límites).
UPDATE "plans" SET "max_emails_month" = 100 WHERE "slug" = 'trial' AND "max_emails_month" IS NULL;--> statement-breakpoint
UPDATE "plans" SET "max_emails_month" = 1000 WHERE "slug" = 'starter' AND "max_emails_month" IS NULL;--> statement-breakpoint
UPDATE "plans" SET "max_emails_month" = 10000 WHERE "slug" = 'pro' AND "max_emails_month" IS NULL;--> statement-breakpoint

-- Contador por empresa y mes (UTC, 'YYYY-MM'): una fila por mes que se
-- incrementa. El histórico queda para auditar el consumo real de cada cliente.
CREATE TABLE IF NOT EXISTS "email_usage" (
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "period" varchar(7) NOT NULL,
    "sent" integer NOT NULL DEFAULT 0,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("tenant_id", "period")
);--> statement-breakpoint

ALTER TABLE "email_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "email_usage" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "email_usage"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
