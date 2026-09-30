-- v0.1.218 — Historial de ediciones masivas (para poder DESHACERLAS).
--
-- Una edición masiva (ADR-S25) puede tocar 5.000 registros de un saque; sin
-- el valor anterior de cada uno, un «subir 10 %» equivocado sólo se arregla a
-- mano. `bulk_edits` es la edición (quién, cuándo, qué se pidió) y
-- `bulk_edit_items` guarda POR FILA sólo lo que cambió: el antes y el después
-- de esas columnas. El después sirve para detectar CONFLICTOS al deshacer: si
-- alguien volvió a tocar la fila, pisarla con el antes perdería su cambio.
--
-- `kind`: 'records' (columnas de la app, claves `f{id}`) o 'store' (campos de
-- WooCommerce en el formato de su API; la fila apunta al producto o variación
-- por su id en la tienda).
CREATE TABLE IF NOT EXISTS "bulk_edits" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "user_id" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "kind" varchar(16) NOT NULL,
    "summary" text NOT NULL DEFAULT '',
    "operations" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "item_count" integer NOT NULL DEFAULT 0,
    "reverted_count" integer NOT NULL DEFAULT 0,
    "reverted_at" timestamptz,
    "reverted_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "bulk_edits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bulk_edits" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bulk_edits"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "bulk_edits" TO imagina_app;--> statement-breakpoint
CREATE INDEX "bulk_edits_list_ix" ON "bulk_edits" ("tenant_id", "list_id", "id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "bulk_edit_items" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "bulk_edit_id" bigint NOT NULL REFERENCES "bulk_edits" ("id") ON DELETE CASCADE,
    -- Registro de la app (kind 'records'). Si lo borran, la fila queda sin
    -- registro y al deshacer se informa como «ya no existe».
    "record_id" bigint REFERENCES "records" ("id") ON DELETE SET NULL,
    -- Producto o variación en la tienda (kind 'store').
    "external_id" varchar(190),
    "parent_external_id" varchar(190),
    "title" text NOT NULL DEFAULT '',
    "before" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "after" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "reverted" boolean NOT NULL DEFAULT false
);--> statement-breakpoint

ALTER TABLE "bulk_edit_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bulk_edit_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "bulk_edit_items"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "bulk_edit_items" TO imagina_app;--> statement-breakpoint
CREATE INDEX "bulk_edit_items_edit_ix" ON "bulk_edit_items" ("bulk_edit_id", "id");
