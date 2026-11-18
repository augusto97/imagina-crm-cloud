-- v0.1.442 (G1, ADR-S105) — Webhooks de eventos.
--
-- `webhook_subscriptions`: «avísale a esta dirección cuando pase esto». De la
-- empresa, pero actúa como quien la creó (sólo manda lo que esa persona ve).
-- El secreto de firma se guarda cifrado (secret-box, SECRETS_KEY).
CREATE TABLE IF NOT EXISTS "webhook_subscriptions" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "name" varchar(80) NOT NULL,
    "url" text NOT NULL,
    "events" text[] NOT NULL,
    -- NULL = todas las listas que ve quien la creó.
    "list_ids" bigint[],
    "secret_enc" text NOT NULL,
    "secret_hint" varchar(8) NOT NULL,
    "active" boolean NOT NULL DEFAULT true,
    "disabled_reason" text,
    "created_by" bigint NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
    -- `app` (Ajustes → API) o `api` (la registró un programa con un token).
    "source" varchar(8) NOT NULL DEFAULT 'app',
    "consecutive_failures" integer NOT NULL DEFAULT 0,
    "last_delivery_at" timestamptz,
    "last_status" varchar(12),
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_subscriptions_tenant_ix" ON "webhook_subscriptions" ("tenant_id") WHERE "active";--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_subscriptions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_subscriptions"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "webhook_subscriptions" TO imagina_app;--> statement-breakpoint

-- `webhook_deliveries`: cada aviso a enviar. La verdad vive aquí (no en la
-- cola): un tic toma lo vencido con FOR UPDATE SKIP LOCKED, así un reinicio
-- no pierde ni duplica entregas. El cuerpo se arma en el primer intento y los
-- reintentos mandan EL MISMO (mismo `event_id`).
CREATE TABLE IF NOT EXISTS "webhook_deliveries" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "subscription_id" bigint NOT NULL REFERENCES "webhook_subscriptions" ("id") ON DELETE CASCADE,
    "event_id" varchar(40) NOT NULL,
    "event" varchar(32) NOT NULL,
    "list_id" bigint,
    "record_id" bigint,
    -- Lo que pasó (antes/después, el formulario, el pago), en crudo.
    "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "payload" jsonb,
    "status" varchar(12) NOT NULL DEFAULT 'pending',
    "attempts" integer NOT NULL DEFAULT 0,
    "next_attempt_at" timestamptz,
    "response_status" integer,
    "response_body" text,
    "error" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "delivered_at" timestamptz
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_due_ix" ON "webhook_deliveries" ("next_attempt_at") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_sub_ix" ON "webhook_deliveries" ("subscription_id", "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_tenant_ix" ON "webhook_deliveries" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webhook_deliveries_created_brin" ON "webhook_deliveries" USING brin ("created_at");--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "webhook_deliveries"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "webhook_deliveries" TO imagina_app;
