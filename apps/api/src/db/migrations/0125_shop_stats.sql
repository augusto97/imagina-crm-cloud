-- v0.1.418 (addendum ADR-S103) — Estadísticas de la tienda.
--
-- Contadores por tienda y por día (en la zona de la empresa) de lo que pasa en
-- la página: visitas, productos abiertos, «agregar al carrito» y «empezar la
-- compra», de dónde llegó la visita y desde qué dispositivo. Son SUMAS, nunca
-- datos de una persona (no hay IP ni cookies). Se suman primero en Redis y
-- cada pocos minutos se vuelcan aquí, igual que las de los formularios y el
-- widget. Los pedidos, lo pagado y lo vendido se cuentan de `shop_orders`.
CREATE TABLE IF NOT EXISTS "shop_stats" (
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "shop_id" bigint NOT NULL REFERENCES "shops" ("id") ON DELETE CASCADE,
    "day" date NOT NULL,
    "counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("shop_id", "day")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "shop_stats_tenant_ix" ON "shop_stats" ("tenant_id", "shop_id", "day");--> statement-breakpoint
ALTER TABLE "shop_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shop_stats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "shop_stats"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "shop_stats" TO imagina_app;
