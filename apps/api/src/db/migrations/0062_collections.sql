-- v0.1.251 (ADR-S31) — Cobros de las empresas a sus clientes (Mercado Pago,
-- Wompi). Cada link de pago queda atado a un registro; el aviso del
-- proveedor lo pasa a pagado (verificado releyendo el pago).
CREATE TABLE IF NOT EXISTS "payment_links" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "connection_id" bigint REFERENCES "connections" ("id") ON DELETE SET NULL,
    "provider" varchar(24) NOT NULL,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "external_id" varchar(128) NOT NULL,
    "url" text NOT NULL,
    "title" varchar(200) NOT NULL,
    "amount" numeric(14, 2) NOT NULL,
    "currency" varchar(8) NOT NULL,
    "status" varchar(16) NOT NULL DEFAULT 'pending',
    "payer_email" varchar(254),
    "expires_at" timestamptz,
    "paid_amount" numeric(14, 2),
    "paid_at" timestamptz,
    "method" varchar(64),
    "payment_id" varchar(128),
    "note" text,
    "created_by" bigint,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    "last_checked_at" timestamptz
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_links_external_ux" ON "payment_links" ("provider", "external_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_links_record_ix" ON "payment_links" ("tenant_id", "record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_links_connection_ix" ON "payment_links" ("tenant_id", "connection_id", "created_at");--> statement-breakpoint
ALTER TABLE "payment_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "payment_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "payment_links"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

-- Token de la URL de avisos de cada conexión de cobro. SIN RLS (como
-- store_hooks): el aviso llega antes de saber de qué empresa es.
CREATE TABLE IF NOT EXISTS "collection_hooks" (
    "token" varchar(64) PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "connection_id" bigint NOT NULL REFERENCES "connections" ("id") ON DELETE CASCADE,
    "provider" varchar(24) NOT NULL,
    "last_hook_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "collection_hooks_connection_ux" ON "collection_hooks" ("connection_id");
