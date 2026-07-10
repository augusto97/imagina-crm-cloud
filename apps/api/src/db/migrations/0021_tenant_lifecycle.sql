-- Ciclo de vida de la empresa desde la consola de operador (ADR-S15):
--  - `subscription_ends_at`: fecha 'paga hasta' que fija el operador (alta manual
--    o prueba con vencimiento). Al pasar, la empresa cae a solo-lectura (ADR-S09,
--    enforcement dinámico en TenantGuard/BillingService — sin secuestrar datos).
--  - `archived_at`: la empresa se archiva (deja de operar → solo-lectura + oculta
--    de la grilla por defecto). Reversible. El borrado REAL es un DELETE aparte.
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "subscription_ends_at" timestamptz;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "archived_at" timestamptz;
