-- Precio de checkout por plan (ADR-S12 + ADR-S15 F3). Antes los precios eran una
-- constante (sólo starter/pro); ahora viven en `plans`, así un plan CUSTOM del
-- operador también se puede vender self-serve. `null` = no vendible en esa moneda
-- (enterprise = "contactar ventas"). Entero: USD sin centavos, COP sin decimales.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "price_usd" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "price_cop" integer;--> statement-breakpoint
-- Semilla de los precios built-in que antes estaban cableados en el front/back.
UPDATE "plans" SET "price_usd" = 15, "price_cop" = 59000 WHERE "slug" = 'starter';--> statement-breakpoint
UPDATE "plans" SET "price_usd" = 49, "price_cop" = 199000 WHERE "slug" = 'pro';
