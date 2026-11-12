-- v0.1.416 (addendum ADR-S103) — Productos digitales y «Mis pedidos».
--
-- `downloads`: cuántas veces se bajó cada archivo de un pedido
-- (`{"<producto>:<archivo>": n}`), con el tope de la tienda. Se suma con un
-- UPDATE condicional (dos clics a la vez no pasan del tope).
-- El índice por correo es el de «Mis pedidos»: los pedidos de una persona en
-- una tienda, sin recorrer todos los de la empresa.
ALTER TABLE "shop_orders" ADD COLUMN IF NOT EXISTS "downloads" jsonb NOT NULL DEFAULT '{}'::jsonb;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_orders_email_ix" ON "shop_orders" ("tenant_id", "shop_id", (lower("customer"->>'email')));
