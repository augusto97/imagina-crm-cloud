-- Cuota de storage por plan (ADR-S16). NULL = ilimitado. Semilla para los
-- built-in; los planes custom quedan en NULL hasta que el operador la fije.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "max_storage_mb" integer;--> statement-breakpoint
UPDATE "plans" SET "max_storage_mb" = 100 WHERE "slug" = 'trial' AND "max_storage_mb" IS NULL;--> statement-breakpoint
UPDATE "plans" SET "max_storage_mb" = 1024 WHERE "slug" = 'starter' AND "max_storage_mb" IS NULL;--> statement-breakpoint
UPDATE "plans" SET "max_storage_mb" = 10240 WHERE "slug" = 'pro' AND "max_storage_mb" IS NULL;
