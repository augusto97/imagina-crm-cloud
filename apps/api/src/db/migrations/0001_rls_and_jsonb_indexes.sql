-- Tenancy con RLS (STANDALONE.md §4, ADR-S04) + índices JSONB (§3.1).
--
-- FORCE ROW LEVEL SECURITY: las policies aplican también al owner de la
-- tabla, así los tests de RLS son reales aunque la app conecte como owner.
-- Sin `app.tenant_id` en el contexto, current_setting(..., true) devuelve
-- NULL → la policy no matchea → cero filas (default deny, nunca fuga).

CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint

DO $$
BEGIN
    -- pg_stat_statements requiere shared_preload_libraries (activo en el
    -- compose de dev); en Postgres efímeros de test puede no estar.
    CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;
--> statement-breakpoint

-- === Índices de records (STANDALONE.md §3.1) ===
CREATE INDEX "idx_records_list" ON "records" ("tenant_id", "list_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "idx_records_data" ON "records" USING gin ("data" jsonb_path_ops);--> statement-breakpoint
-- FTS nativo sin columna extra (reemplaza el índice BM25 casero del plugin):
CREATE INDEX "idx_records_fts" ON "records" USING gin (jsonb_to_tsvector('simple', "data", '["string"]'));--> statement-breakpoint

-- === RLS: aislamiento por tenant ===
ALTER TABLE "lists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lists" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "lists"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

ALTER TABLE "fields" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "fields" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "fields"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

ALTER TABLE "records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "records"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

-- memberships es la tabla puente auth↔tenant: además del aislamiento por
-- tenant, el plano auth (login, listado de workspaces) necesita leer las
-- memberships PROPIAS antes de que exista tenant activo. Dos policies
-- permisivas (se combinan con OR): tenant activo, o filas del propio usuario.
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "memberships"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
CREATE POLICY "memberships_self" ON "memberships"
    USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::bigint);
