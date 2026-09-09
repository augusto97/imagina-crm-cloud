-- v0.1.167 — Plantillas de dashboards y de automatizaciones del workspace.
--
-- La tabla de plantillas de lista (v0.1.166) pasa a ser LA tabla de
-- plantillas: una columna `kind` distingue lista / dashboard / automatización
-- y el `blueprint` jsonb guarda el cuerpo de cada tipo (schemas en shared:
-- listBlueprintSchema / dashboardTemplateSchema / automationTemplateSchema).
-- Se renombra en vez de crear tres tablas iguales; la política RLS y el
-- índice se conservan (viajan con la tabla).
ALTER TABLE "list_templates" RENAME TO "templates";--> statement-breakpoint
ALTER TABLE "templates" ADD COLUMN "kind" varchar(16) NOT NULL DEFAULT 'list';--> statement-breakpoint
ALTER INDEX IF EXISTS "list_templates_tenant_ix" RENAME TO "templates_tenant_ix";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "templates_tenant_kind_ix" ON "templates" ("tenant_id", "kind", "created_at");
