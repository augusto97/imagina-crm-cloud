-- v0.1.417 (addendum ADR-S103) — Suscripciones desde la tienda.
--
-- Un pedido de suscripción recuerda su suscripción (débito automático de
-- Mercado Pago o PayPal): así la página del pedido muestra cómo va y, cuando
-- la persona autoriza la tarjeta, el pedido queda pagado. Si la suscripción
-- se borra, el pedido queda (sin el vínculo).
ALTER TABLE "shop_orders" ADD COLUMN IF NOT EXISTS "subscription_id" bigint;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_subscription_fk" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_orders_subscription_ix" ON "shop_orders" ("subscription_id") WHERE "subscription_id" IS NOT NULL;
