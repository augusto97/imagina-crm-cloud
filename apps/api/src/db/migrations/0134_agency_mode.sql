-- v0.1.449 (I3, ADR-S108) — Modo agencia.
--
-- Una AGENCIA es una empresa que administra otras (sus clientes). El operador
-- la marca (`is_agency`) y le pone sus ajustes (`settings.agency`); cada
-- cliente apunta a su agencia (`agency_id`, una sola). Una agencia no puede
-- ser cliente de otra. Borrar una agencia con clientes se rechaza (RESTRICT):
-- primero se desvinculan.
--
-- `agency_paused_at`: la agencia pausó a ese cliente (queda en sólo lectura).
-- `memberships.via_agency`: la persona entra a la empresa cliente como parte
-- de su agencia (admin, con rastro en la bitácora del cliente; no ocupa un
-- usuario del plan y se revalida en cada pedido).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "is_agency" boolean NOT NULL DEFAULT false;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "agency_id" bigint REFERENCES "tenants"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "agency_paused_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenants_agency_ix" ON "tenants" ("agency_id") WHERE "agency_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" DROP CONSTRAINT IF EXISTS "tenants_agency_ck";--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_agency_ck" CHECK (NOT ("is_agency" AND "agency_id" IS NOT NULL) AND ("agency_id" IS NULL OR "agency_id" <> "id"));--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "via_agency" boolean NOT NULL DEFAULT false;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_via_agency_ix" ON "memberships" ("user_id") WHERE "via_agency";
