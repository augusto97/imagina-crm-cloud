-- v0.1.181 (ADR-S21) — Asistente IA. Cuota mensual de pedidos hechos CON LA
-- CLAVE DE LA PLATAFORMA (la paga el operador). Con clave propia de la
-- empresa (BYOK) no hay cuota: misma lógica que el SMTP propio (ADR-S18).
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "max_ai_requests_month" integer;--> statement-breakpoint

-- Semilla de los built-in (NULL = ilimitado).
UPDATE "plans" SET "max_ai_requests_month" = 20 WHERE "slug" = 'trial' AND "max_ai_requests_month" IS NULL;--> statement-breakpoint
UPDATE "plans" SET "max_ai_requests_month" = 100 WHERE "slug" = 'starter' AND "max_ai_requests_month" IS NULL;--> statement-breakpoint
UPDATE "plans" SET "max_ai_requests_month" = 500 WHERE "slug" = 'pro' AND "max_ai_requests_month" IS NULL;--> statement-breakpoint

-- Contador por empresa y mes (UTC, 'YYYY-MM') con los tokens consumidos, para
-- que el operador vea el costo real por cliente.
CREATE TABLE IF NOT EXISTS "ai_usage" (
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "period" varchar(7) NOT NULL,
    "requests" integer NOT NULL DEFAULT 0,
    "input_tokens" bigint NOT NULL DEFAULT 0,
    "output_tokens" bigint NOT NULL DEFAULT 0,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("tenant_id", "period")
);--> statement-breakpoint

ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_usage" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_usage"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
