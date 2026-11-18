-- v0.1.439 — Retención elegible por el operador (Plataforma → Diagnóstico).
--
-- La actividad de los registros se puede podar por antigüedad si el operador
-- lo elige (por defecto no se borra). Un índice BRIN por fecha es chico y
-- barato de mantener en una tabla que sólo crece, y le evita a la limpieza
-- recorrer la tabla entera. `automation_runs` ya tiene el suyo (0111).
CREATE INDEX IF NOT EXISTS "activity_created_brin" ON "activity" USING brin ("created_at");
