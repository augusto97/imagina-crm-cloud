-- v0.1.412 (ADR-S103) — Tienda desde una lista.
--
-- `shops`: la tienda. Su catálogo es una lista de la empresa (cada registro es
-- un producto) y sus pedidos caen en un pack de listas vinculadas que arma la
-- tienda (Pedidos, Líneas de pedido y Clientes). El token es la dirección
-- pública y se busca ANTES de conocer la empresa (conexión base), como el de
-- los formularios y el widget de contacto.
CREATE TABLE IF NOT EXISTS "shops" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "name" varchar(120) NOT NULL,
    "token" varchar(64) NOT NULL,
    "enabled" boolean NOT NULL DEFAULT false,
    "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- El diseño (motor de temas, ADR-S94).
    "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- La plataforma puede apagar una tienda (fraude, phishing): nadie de la
    -- empresa la vuelve a encender.
    "suspended_at" timestamptz,
    "suspended_reason" text,
    "created_by" bigint,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shops_tenant_ix" ON "shops" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shops_list_ix" ON "shops" ("list_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shops_token_ux" ON "shops" ("token");--> statement-breakpoint
ALTER TABLE "shops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shops" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shops"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "shops" TO imagina_app;--> statement-breakpoint

-- `shop_orders`: lo que la tienda sabe de cada pedido (la verdad del motor).
-- El registro de «Pedidos» es lo que ve y trabaja el equipo. Guarda el
-- catálogo y el campo de stock del momento: si la tienda se borra, cancelar
-- un pedido igual devuelve el stock.
CREATE TABLE IF NOT EXISTS "shop_orders" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "shop_id" bigint REFERENCES "shops" ("id") ON DELETE SET NULL,
    "record_id" bigint REFERENCES "records" ("id") ON DELETE SET NULL,
    "token" varchar(64) NOT NULL,
    "number" varchar(40) NOT NULL DEFAULT '',
    "payment_method" varchar(16) NOT NULL,
    "payment_status" varchar(16) NOT NULL DEFAULT 'pendiente',
    "currency" varchar(8) NOT NULL,
    "subtotal" numeric(14, 2) NOT NULL DEFAULT 0,
    "shipping" numeric(14, 2) NOT NULL DEFAULT 0,
    "discount" numeric(14, 2) NOT NULL DEFAULT 0,
    "total" numeric(14, 2) NOT NULL DEFAULT 0,
    "lines" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "customer" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "delivery" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "origin" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "catalog_list_id" bigint,
    "stock_field_id" bigint,
    -- La columna «Estado del pedido»: cancelarlo devuelve el stock aunque la
    -- tienda ya no exista.
    "status_field_id" bigint,
    -- `taken` = descontó stock, `returned` = lo devolvió al cancelar, `none` = no controla stock.
    "stock_state" varchar(12) NOT NULL DEFAULT 'none',
    -- v0.1.413 — El link de pago en línea y hasta cuándo se aparta el stock.
    "payment_link_id" bigint,
    "expires_at" timestamptz,
    "paid_at" timestamptz,
    "cancelled_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shop_orders_token_ux" ON "shop_orders" ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_orders_shop_ix" ON "shop_orders" ("tenant_id", "shop_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_orders_record_ix" ON "shop_orders" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_orders_expiring_ix" ON "shop_orders" ("expires_at")
    WHERE "payment_status" = 'pendiente' AND "expires_at" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "shop_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shop_orders" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shop_orders"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "shop_orders" TO imagina_app;--> statement-breakpoint

-- La tienda va sólo en los planes pagos: las tiendas falsas suelen nacer en una
-- prueba gratis y quedan publicadas en el dominio de la plataforma. El operador
-- la puede volver a incluir en «Planes».
UPDATE "plans" SET "disabled_modules" = "disabled_modules" || '["shop"]'::jsonb
    WHERE "slug" = 'trial' AND NOT ("disabled_modules" ? 'shop');
