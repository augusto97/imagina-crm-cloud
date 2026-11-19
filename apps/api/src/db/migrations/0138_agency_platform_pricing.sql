-- v0.1.454 (I3, ADR-S108) — Lo que la plataforma le cobra a una agencia.
--
-- Decisión del usuario: un plan base que incluye N empresas cliente y un valor
-- por cada empresa extra al mes. Lo dice el plan de la plataforma (NULL = el
-- precio incluye todas las empresas); el operador puede pisarlo para una
-- agencia puntual en `tenants.settings.agency` (sin migración).
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "agency_included_clients" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "agency_extra_usd" integer;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "agency_extra_cop" integer;
