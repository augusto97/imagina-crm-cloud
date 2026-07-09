-- Automatizaciones: modelo flexible alineado al plugin (paridad total).
-- automations: trigger (jsonb typed) + condition → trigger_type + trigger_config
--   + description. actions cambia de shape (typed → ActionSpec laxo) pero el
--   tipo de columna (jsonb) no cambia, así que no requiere ALTER.
-- automation_runs: logs/duration_ms → actions_log + error + started_at/finished_at.

ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "description" text;
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "trigger_type" text;
ALTER TABLE "automations" ADD COLUMN IF NOT EXISTS "trigger_config" jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Backfill best-effort desde el modelo viejo (trigger jsonb typed).
UPDATE "automations"
SET "trigger_type" = COALESCE("trigger" ->> 'type', 'record_created')
WHERE "trigger_type" IS NULL AND "trigger" IS NOT NULL;
UPDATE "automations"
SET "trigger_config" = COALESCE(("trigger" - 'type'), '{}'::jsonb)
WHERE "trigger" IS NOT NULL;
UPDATE "automations" SET "trigger_type" = 'record_created' WHERE "trigger_type" IS NULL;

ALTER TABLE "automations" ALTER COLUMN "trigger_type" SET NOT NULL;
ALTER TABLE "automations" DROP COLUMN IF EXISTS "trigger";
ALTER TABLE "automations" DROP COLUMN IF EXISTS "condition";

ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "actions_log" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "error" text;
ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "started_at" timestamptz;
ALTER TABLE "automation_runs" ADD COLUMN IF NOT EXISTS "finished_at" timestamptz;
ALTER TABLE "automation_runs" DROP COLUMN IF EXISTS "logs";
ALTER TABLE "automation_runs" DROP COLUMN IF EXISTS "duration_ms";
