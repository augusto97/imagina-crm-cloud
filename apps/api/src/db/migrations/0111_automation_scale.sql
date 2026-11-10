-- v0.1.392 — Automatizaciones a escala.
-- 1) El borrado del historial de corridas de más de 90 días (cada hora) no
--    tenía índice por fecha: recorría la tabla entera. BRIN sobre created_at
--    (la tabla es de sólo-agregar, las filas nuevas siempre van al final): un
--    índice de pocos KB que acota el borrado a los bloques viejos.
CREATE INDEX IF NOT EXISTS "automation_runs_created_brin" ON "automation_runs" USING brin ("created_at");--> statement-breakpoint
-- 2) El escaneo de vencimientos ahora sólo mira lo nuevo desde la última
--    vuelta; los reintentos de una corrida fallida se buscan por este índice
--    (sólo las fallidas: chico).
CREATE INDEX IF NOT EXISTS "automation_runs_failed_ix" ON "automation_runs" ("automation_id", "created_at") WHERE "status" = 'failed';
--> statement-breakpoint
-- 3) Las corridas que quedaron «en curso» por un reinicio se buscan cada hora:
--    sin índice, también recorría la tabla entera. Parcial: casi siempre vacío.
CREATE INDEX IF NOT EXISTS "automation_runs_running_ix" ON "automation_runs" ("created_at") WHERE "status" = 'running';
