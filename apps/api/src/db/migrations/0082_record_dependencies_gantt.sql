-- A8 — Dependencias entre registros: «blocker bloquea a blocked».
--
-- Una fila propia (no un campo relation): tiene dirección, desfase en días y la
-- regla «sin ciclos» (la valida el servidor con un candado por lista). Cada
-- punta guarda su lista: hoy son la misma; permitir otra lista después es sólo
-- levantar esa validación. Un registro en la papelera deja la dependencia
-- INERTE (las lecturas cruzan records.deleted_at IS NULL) y vuelve con él si se
-- restaura; purgarlo la borra en cascada.
CREATE TABLE IF NOT EXISTS "record_dependencies" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "blocker_list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "blocker_record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "blocked_list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "blocked_record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "lag_days" integer NOT NULL DEFAULT 0,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "record_dependencies_pair_ux" UNIQUE ("blocker_record_id", "blocked_record_id"),
    CONSTRAINT "record_dependencies_not_self" CHECK ("blocker_record_id" <> "blocked_record_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_dependencies_blocked_ix" ON "record_dependencies" ("blocked_record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_dependencies_blocker_list_ix" ON "record_dependencies" ("blocker_list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_dependencies_blocked_list_ix" ON "record_dependencies" ("tenant_id", "blocked_list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_dependencies_created_by_ix" ON "record_dependencies" ("created_by");--> statement-breakpoint
ALTER TABLE "record_dependencies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_dependencies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "record_dependencies"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "record_dependencies" TO imagina_app;--> statement-breakpoint

-- B1 — Línea base del Gantt: las fechas congeladas para comparar después. Una
-- por vista (guardar otra la reemplaza); los ítems, una fila por registro.
CREATE TABLE IF NOT EXISTS "gantt_baselines" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "view_id" bigint NOT NULL REFERENCES "saved_views" ("id") ON DELETE CASCADE,
    "name" varchar(120) NOT NULL DEFAULT '',
    "start_field_id" bigint NOT NULL,
    "end_field_id" bigint,
    "item_count" integer NOT NULL DEFAULT 0,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "gantt_baselines_view_ux" UNIQUE ("view_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gantt_baselines_list_ix" ON "gantt_baselines" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gantt_baselines_tenant_ix" ON "gantt_baselines" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gantt_baselines_created_by_ix" ON "gantt_baselines" ("created_by");--> statement-breakpoint
ALTER TABLE "gantt_baselines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gantt_baselines" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "gantt_baselines"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "gantt_baselines" TO imagina_app;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "gantt_baseline_items" (
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "baseline_id" bigint NOT NULL REFERENCES "gantt_baselines" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "start_value" varchar(40),
    "end_value" varchar(40),
    PRIMARY KEY ("baseline_id", "record_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gantt_baseline_items_record_ix" ON "gantt_baseline_items" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "gantt_baseline_items_tenant_ix" ON "gantt_baseline_items" ("tenant_id");--> statement-breakpoint
ALTER TABLE "gantt_baseline_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "gantt_baseline_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "gantt_baseline_items"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "gantt_baseline_items" TO imagina_app;
