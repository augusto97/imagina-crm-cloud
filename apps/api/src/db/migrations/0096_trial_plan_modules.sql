-- v0.1.338 (ADR-S87) — Prueba con fecha de fin y módulos por plan.
--
-- `tenants.trial_ends_at`: cuándo termina la prueba de una empresa en el plan
-- `trial`. NULL = no vence: así quedan las empresas que ya existían (ninguna se
-- pausa sola por actualizar); el operador les pone fecha desde la consola. El
-- registro público y el alta del operador la fijan con la política de la
-- plataforma.
--
-- `plans.disabled_modules`: lo que un plan NO incluye (lista de claves). Se
-- guardan los desactivados para que un módulo nuevo de una versión futura
-- quede incluido en todos los planes hasta que el operador diga lo contrario.
-- Vacío = todo incluido (el comportamiento anterior).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "trial_ends_at" timestamptz;--> statement-breakpoint
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "disabled_modules" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
-- El barrido de vencimientos busca pruebas por terminar sin recorrer la tabla.
CREATE INDEX IF NOT EXISTS "tenants_trial_ends_idx" ON "tenants" ("trial_ends_at") WHERE "trial_ends_at" IS NOT NULL;
