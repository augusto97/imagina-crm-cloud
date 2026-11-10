-- v0.1.393 — Integraciones y tareas periódicas a escala.
-- Una recurrencia que llegó a su «repetir hasta» deja su fecha en el pasado
-- para siempre: el barrido cada 5 minutos la volvía a tomar (y abría una
-- transacción con candado sobre el registro) sin hacer nada, cada vez. Se
-- anota con qué valor de la fecha se detuvo: mientras la fecha siga siendo
-- ésa, el barrido la saltea; si alguien cambia la fecha, vuelve a contar.
ALTER TABLE "recurrences" ADD COLUMN IF NOT EXISTS "stopped_value" text;
--> statement-breakpoint
-- La retención (borra por fecha cada hora) necesita llegar a lo viejo sin
-- recorrer la tabla entera. BRIN: tablas de sólo-agregar, índices de pocos KB.
CREATE INDEX IF NOT EXISTS "notifications_created_brin" ON "notifications" USING brin ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "reminders_created_brin" ON "reminders" USING brin ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_runs_created_brin" ON "ai_agent_runs" USING brin ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "sms_messages_created_brin" ON "sms_messages" USING brin ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_edits_created_brin" ON "bulk_edits" USING brin ("created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_resolved_ix" ON "incidents" ("resolved_at") WHERE "resolved_at" IS NOT NULL;
