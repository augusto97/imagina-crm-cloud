-- v0.1.411 — Carpetas de automatizaciones. Cada automatización puede vivir
-- en una carpeta de SU lista (el nombre de la carpeta). El orden de las
-- carpetas, y las que todavía están vacías, viven en
-- lists.settings.automation_folders (un arreglo de nombres).
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "folder" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "automations_list_folder_idx" ON "automations" ("tenant_id", "list_id", "folder") WHERE "deleted_at" IS NULL;
