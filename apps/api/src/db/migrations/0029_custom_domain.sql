-- Dominio personalizado por tenant (ADR-S17, white-label completo).
-- UNIQUE permite múltiples NULL (Postgres trata NULLs como distintos).
ALTER TABLE "tenants" ADD COLUMN "custom_domain" varchar(253);
--> statement-breakpoint
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_custom_domain_unique" UNIQUE("custom_domain");
