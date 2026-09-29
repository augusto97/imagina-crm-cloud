-- v0.1.206 (ADR-S24) — Sincronización con tiendas (WooCommerce).
--
-- `connection_syncs`: UNA sincronización por conexión. `settings` guarda lo
-- que eligió la persona (qué traer, cada cuánto, qué listas y qué campo de
-- cada lista recibe cada dato, POR ID — regla de oro nº 1) y `state` lo que
-- escribe el motor (cursores, progreso, errores, claves meta descubiertas).
-- Separarlos evita que el motor, que escribe `state` en cada página, pise un
-- cambio de ajustes hecho en paralelo desde la interfaz.
CREATE TABLE IF NOT EXISTS "connection_syncs" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "connection_id" bigint NOT NULL REFERENCES "connections" ("id") ON DELETE CASCADE,
    "provider" varchar(32) NOT NULL,
    "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "state" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "enabled" boolean NOT NULL DEFAULT true,
    "next_run_at" timestamptz,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "connection_syncs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connection_syncs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "connection_syncs"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "connection_syncs" TO imagina_app;--> statement-breakpoint
CREATE UNIQUE INDEX "connection_syncs_connection_ux" ON "connection_syncs" ("connection_id");--> statement-breakpoint
-- El tick global busca las que tocan (cross-tenant, por la conexión base).
CREATE INDEX "connection_syncs_due_ix" ON "connection_syncs" ("next_run_at") WHERE "enabled";--> statement-breakpoint

-- `sync_links`: "el pedido 1234 de ESTA tienda es el registro N". Es lo que
-- convierte la sincronización en una ACTUALIZACIÓN y no en un alta repetida.
-- Borrar el registro borra el vínculo (si alguien lo borra a mano, la próxima
-- vuelta lo vuelve a traer); borrar la sincronización borra todos.
CREATE TABLE IF NOT EXISTS "sync_links" (
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "sync_id" bigint NOT NULL REFERENCES "connection_syncs" ("id") ON DELETE CASCADE,
    "resource" varchar(32) NOT NULL,
    "external_id" varchar(190) NOT NULL,
    -- El dueño en la tienda: el pedido de una línea, el producto de una
    -- variación. Sirve para borrar las líneas que un pedido ya no tiene.
    "parent_external_id" varchar(190),
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("sync_id", "resource", "external_id")
);--> statement-breakpoint

ALTER TABLE "sync_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sync_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "sync_links"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "sync_links" TO imagina_app;--> statement-breakpoint
CREATE INDEX "sync_links_record_ix" ON "sync_links" ("record_id");--> statement-breakpoint
CREATE INDEX "sync_links_parent_ix" ON "sync_links" ("sync_id", "resource", "parent_external_id");
