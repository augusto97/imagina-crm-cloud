-- Filtros guardados por lista (herencia del plugin, estilo ClickUp). El front
-- ya los consumía (`/lists/:id/saved-filters`) pero no existía la tabla → 404.
-- Tenant-scoped con RLS (mismo patrón que saved_views — ADR-S04). `user_id`
-- null = filtro del workspace (shared); un id = personal de ese usuario.
CREATE TABLE IF NOT EXISTS "saved_filters" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id"),
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "user_id" bigint REFERENCES "users" ("id") ON DELETE CASCADE,
    "name" text NOT NULL,
    "filter_tree" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "saved_filters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "saved_filters" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "saved_filters"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

CREATE INDEX "saved_filters_list_idx" ON "saved_filters" ("tenant_id", "list_id");
