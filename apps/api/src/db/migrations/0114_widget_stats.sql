-- v0.1.396 — Widget de contacto: estadísticas por botón.
--
-- Contadores por widget y por día (en la zona de la empresa): cuántas veces
-- apareció, cuántas lo abrieron, los toques de cada botón, el saludo y los
-- registros que llegaron por cada botón. Son SUMAS, nunca datos de una persona
-- (no hay IP ni cookies). Se suman primero en Redis y cada pocos minutos se
-- vuelcan aquí, igual que las de los formularios.
CREATE TABLE IF NOT EXISTS "widget_stats" (
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "widget_id" bigint NOT NULL REFERENCES "contact_widgets" ("id") ON DELETE CASCADE,
    "day" date NOT NULL,
    "counts" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("widget_id", "day")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "widget_stats_tenant_ix" ON "widget_stats" ("tenant_id", "widget_id", "day");--> statement-breakpoint
ALTER TABLE "widget_stats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "widget_stats" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "widget_stats"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "widget_stats" TO imagina_app;
