-- v0.1.132 — Subtareas: un registro puede colgar de otro de la MISMA lista.
--
-- Un solo nivel de anidado (una subtarea no puede tener subtareas): es lo que
-- se necesita para desglosar trabajo y evita árboles arbitrarios en una tabla
-- que ya pagina por keyset. Lo valida el service.
--
-- ON DELETE CASCADE cubre el borrado DURO (purge); el borrado normal es lógico
-- (`deleted_at`) y el service se encarga de bajar también a las subtareas —
-- si no, quedarían colgando de un padre que ya no se ve.
ALTER TABLE "records" ADD COLUMN IF NOT EXISTS "parent_id" bigint
    REFERENCES "records" ("id") ON DELETE CASCADE;--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "records_parent_ix" ON "records" ("tenant_id", "parent_id")
    WHERE "parent_id" IS NOT NULL;
