-- Papelera: listas, campos, vistas, automatizaciones y tableros dejan de
-- borrarse de verdad; se marcan (`deleted_at` + `deleted_by`) y se purgan a
-- los 30 días. Los registros ya se borraban de forma lógica: ganan
-- `deleted_by`.
--
-- Lo borrado se OCULTA en la RLS (no en cada consulta): la policy de cada
-- tabla sólo deja ver una fila borrada cuando la transacción encendió
-- `app.trash = 'on'` (la papelera, restaurar, purgar). Así, para el resto de
-- la app lo que está en la papelera es exactamente como si no existiera —
-- igual que después de un borrado de verdad — sin tocar las cientos de
-- lecturas que hay. La conexión base (superusuario) no pasa por la RLS: los
-- pocos barridos cross-tenant filtran `deleted_at` a mano.

ALTER TABLE "lists" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "deleted_by" bigint;--> statement-breakpoint
ALTER TABLE "fields" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "fields" ADD COLUMN "deleted_by" bigint;--> statement-breakpoint
ALTER TABLE "saved_views" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saved_views" ADD COLUMN "deleted_by" bigint;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "automations" ADD COLUMN "deleted_by" bigint;--> statement-breakpoint
ALTER TABLE "dashboards" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "dashboards" ADD COLUMN "deleted_by" bigint;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "deleted_by" bigint;--> statement-breakpoint

-- Los nombres internos (slug) sólo son únicos entre lo VIVO: lo que está en
-- la papelera libera el suyo (al restaurar, si otro lo tomó, se le pone un
-- sufijo). Lo mismo con "una sola vista/un solo tablero por defecto".
DROP INDEX IF EXISTS "lists_tenant_slug_ux";--> statement-breakpoint
CREATE UNIQUE INDEX "lists_tenant_slug_ux" ON "lists" ("tenant_id", "slug") WHERE "deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "fields_list_slug_ux";--> statement-breakpoint
CREATE UNIQUE INDEX "fields_list_slug_ux" ON "fields" ("list_id", "slug") WHERE "deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "saved_views_one_default_per_list";--> statement-breakpoint
CREATE UNIQUE INDEX "saved_views_one_default_per_list" ON "saved_views" ("tenant_id", "list_id") WHERE "is_default" AND "deleted_at" IS NULL;--> statement-breakpoint
DROP INDEX IF EXISTS "dashboards_one_default_per_tenant";--> statement-breakpoint
CREATE UNIQUE INDEX "dashboards_one_default_per_tenant" ON "dashboards" ("tenant_id") WHERE "is_default" AND "deleted_at" IS NULL;--> statement-breakpoint

-- El listado de la papelera y el barrido diario.
CREATE INDEX "lists_trash_ix" ON "lists" ("tenant_id", "deleted_at") WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "fields_trash_ix" ON "fields" ("tenant_id", "deleted_at") WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "saved_views_trash_ix" ON "saved_views" ("tenant_id", "deleted_at") WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "automations_trash_ix" ON "automations" ("tenant_id", "deleted_at") WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "dashboards_trash_ix" ON "dashboards" ("tenant_id", "deleted_at") WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "records_trash_ix" ON "records" ("tenant_id", "deleted_at") WHERE "deleted_at" IS NOT NULL;--> statement-breakpoint

-- RLS: lo borrado sólo se ve con `app.trash = 'on'`. WITH CHECK queda igual
-- (sólo el tenant): marcar una fila como borrada no la "saca" del tenant.
DROP POLICY IF EXISTS "tenant_isolation" ON "lists";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lists"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint
        AND ("deleted_at" IS NULL OR current_setting('app.trash', true) = 'on'))
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "fields";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fields"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint
        AND ("deleted_at" IS NULL OR current_setting('app.trash', true) = 'on'))
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "saved_views";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "saved_views"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint
        AND ("deleted_at" IS NULL OR current_setting('app.trash', true) = 'on'))
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "automations";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "automations"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint
        AND ("deleted_at" IS NULL OR current_setting('app.trash', true) = 'on'))
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
DROP POLICY IF EXISTS "tenant_isolation" ON "dashboards";--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "dashboards"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint
        AND ("deleted_at" IS NULL OR current_setting('app.trash', true) = 'on'))
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
