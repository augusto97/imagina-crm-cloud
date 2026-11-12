-- v0.1.415 (addendum ADR-S103) — Cupones de la tienda.
--
-- `shop_coupons`: un código por tienda (en mayúsculas, único por tienda). Los
-- usos NO se guardan en un contador: se cuentan de `shop_orders` (pedidos con
-- ese cupón que no están cancelados) bajo el bloqueo de la fila del cupón, así
-- cancelar o vencer un pedido libera su uso sin más, y un pago tardío que
-- revive el pedido lo vuelve a contar.
CREATE TABLE IF NOT EXISTS "shop_coupons" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "shop_id" bigint NOT NULL REFERENCES "shops" ("id") ON DELETE CASCADE,
    "code" varchar(40) NOT NULL,
    "description" varchar(200) NOT NULL DEFAULT '',
    "kind" varchar(16) NOT NULL,
    "value" numeric(14, 2) NOT NULL DEFAULT 0,
    "min_subtotal" numeric(14, 2),
    "max_uses" integer,
    "once_per_customer" boolean NOT NULL DEFAULT false,
    "starts_on" date,
    "ends_on" date,
    -- `{product_ids: number[], categories: string[]}`: vacío = toda la tienda.
    "scope" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "active" boolean NOT NULL DEFAULT true,
    "created_by" bigint,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shop_coupons_code_ux" ON "shop_coupons" ("shop_id", "code");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_coupons_tenant_ix" ON "shop_coupons" ("tenant_id");--> statement-breakpoint
ALTER TABLE "shop_coupons" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shop_coupons" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shop_coupons"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "shop_coupons" TO imagina_app;--> statement-breakpoint

-- El pedido recuerda su cupón (el código queda aunque el cupón se borre).
ALTER TABLE "shop_orders" ADD COLUMN IF NOT EXISTS "coupon_id" bigint REFERENCES "shop_coupons" ("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD COLUMN IF NOT EXISTS "coupon_code" varchar(40) NOT NULL DEFAULT '';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_orders_coupon_ix" ON "shop_orders" ("coupon_id") WHERE "coupon_id" IS NOT NULL;
