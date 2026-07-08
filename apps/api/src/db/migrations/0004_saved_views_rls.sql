-- RLS para saved_views (mismo patrón que lists/fields/records — ADR-S04).
-- Los grants los da automáticamente el ALTER DEFAULT PRIVILEGES de 0002
-- (la tabla se crea después, con el mismo owner).

ALTER TABLE "saved_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "saved_views" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "saved_views"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

-- Un solo default por lista: índice único parcial sobre is_default = true.
CREATE UNIQUE INDEX "saved_views_one_default_per_list"
    ON "saved_views" ("tenant_id", "list_id") WHERE "is_default";--> statement-breakpoint

CREATE INDEX "saved_views_list_idx" ON "saved_views" ("tenant_id", "list_id");
