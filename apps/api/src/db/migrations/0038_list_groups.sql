-- v0.1.130 — Carpetas de listas.
--
-- Con muchas listas el menú se vuelve una lista plana imposible de escanear
-- (ClickUp resuelve esto con espacios y carpetas). Acá alcanza UN nivel: una
-- carpeta agrupa listas, y las listas sin carpeta siguen colgando de la raíz.
--
-- `lists.group_id` es NULLABLE y borra en SET NULL a propósito: borrar una
-- carpeta NO puede llevarse las listas puestas — vuelven a la raíz.
CREATE TABLE IF NOT EXISTS "list_groups" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id"),
    "name" text NOT NULL,
    "position" integer NOT NULL DEFAULT 0,
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "list_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "list_groups" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "list_groups"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

CREATE INDEX "list_groups_tenant_pos_ix" ON "list_groups" ("tenant_id", "position");--> statement-breakpoint

ALTER TABLE "lists" ADD COLUMN IF NOT EXISTS "group_id" bigint
    REFERENCES "list_groups" ("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lists_group_ix" ON "lists" ("tenant_id", "group_id");
