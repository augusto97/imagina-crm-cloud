-- A9 — Checklist dentro del registro + C6 — Plantillas de registro.
--
-- Un registro puede tener VARIOS checklists con nombre; cada ítem tiene texto,
-- casilla (quién y cuándo la marcó), responsable, fecha (sin hora: `due_date`;
-- con hora: `due_at` — nunca las dos) y su orden. Los ítems repiten `list_id`
-- y `record_id` a propósito: el progreso del listado («☑ 3/8») y «Mi trabajo»
-- (lo asignado a cada persona) se resuelven con un índice, sin cruzar el
-- checklist. Un registro en la papelera deja sus checklists ocultos (toda
-- lectura cruza el registro vivo) y vuelven con él; purgarlo los borra en
-- cascada.
CREATE TABLE IF NOT EXISTS "record_checklists" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "name" varchar(120) NOT NULL DEFAULT 'Checklist',
    "position" integer NOT NULL DEFAULT 0,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_checklists_record_ix" ON "record_checklists" ("record_id", "position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_checklists_list_ix" ON "record_checklists" ("tenant_id", "list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_checklists_created_by_ix" ON "record_checklists" ("created_by");--> statement-breakpoint
ALTER TABLE "record_checklists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_checklists" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "record_checklists"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "record_checklists" TO imagina_app;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "record_checklist_items" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "checklist_id" bigint NOT NULL REFERENCES "record_checklists" ("id") ON DELETE CASCADE,
    "text" varchar(500) NOT NULL,
    "done" boolean NOT NULL DEFAULT false,
    "done_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "done_at" timestamptz,
    "assignee_id" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "due_date" date,
    "due_at" timestamptz,
    "position" integer NOT NULL DEFAULT 0,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "record_checklist_items_one_due" CHECK ("due_date" IS NULL OR "due_at" IS NULL)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_checklist_items_checklist_ix" ON "record_checklist_items" ("checklist_id", "position");--> statement-breakpoint
-- Progreso por registro (listado y campo «Progreso del checklist»): index-only.
CREATE INDEX IF NOT EXISTS "record_checklist_items_record_ix" ON "record_checklist_items" ("record_id", "done");--> statement-breakpoint
-- «Mi trabajo»: lo pendiente asignado a cada persona.
CREATE INDEX IF NOT EXISTS "record_checklist_items_assignee_ix" ON "record_checklist_items" ("tenant_id", "assignee_id") WHERE NOT "done";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_checklist_items_list_ix" ON "record_checklist_items" ("tenant_id", "list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_checklist_items_done_by_ix" ON "record_checklist_items" ("done_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_checklist_items_assignee_fk_ix" ON "record_checklist_items" ("assignee_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_checklist_items_created_by_ix" ON "record_checklist_items" ("created_by");--> statement-breakpoint
ALTER TABLE "record_checklist_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_checklist_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "record_checklist_items"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "record_checklist_items" TO imagina_app;--> statement-breakpoint

-- C6 — Plantillas de registro (`kind = 'record'`: valores + subtareas +
-- checklists + descripción) y de checklist (`kind = 'checklist'`: un
-- checklist con nombre que se aplica a un registro). Por lista. El contenido
-- referencia campos y personas por ID (las plantillas de lista y la migración
-- de empresa lo re-apuntan).
CREATE TABLE IF NOT EXISTS "record_templates" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "kind" varchar(16) NOT NULL DEFAULT 'record',
    "name" varchar(120) NOT NULL,
    "description" varchar(500),
    "icon" varchar(64),
    "color" varchar(32),
    "content" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "position" integer NOT NULL DEFAULT 0,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "record_templates_kind_ck" CHECK ("kind" IN ('record', 'checklist'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_templates_list_ix" ON "record_templates" ("tenant_id", "list_id", "kind", "position");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_templates_list_fk_ix" ON "record_templates" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_templates_created_by_ix" ON "record_templates" ("created_by");--> statement-breakpoint
ALTER TABLE "record_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_templates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "record_templates"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "record_templates" TO imagina_app;
