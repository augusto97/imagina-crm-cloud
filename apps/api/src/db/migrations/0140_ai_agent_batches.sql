-- v0.1.456 (ADR-S109): un agente de IA corrido en lote sobre registros que ya
-- existen. El lote guarda los registros elegidos y cuántas corridas creó; las
-- corridas se crean por tandas (respetando los topes del agente y la cuota) y
-- cada una apunta a su lote.
CREATE TABLE IF NOT EXISTS "ai_agent_batches" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
    "agent_id" bigint NOT NULL REFERENCES "ai_agents"("id") ON DELETE CASCADE,
    "list_id" bigint REFERENCES "lists"("id") ON DELETE SET NULL,
    "created_by" bigint REFERENCES "users"("id") ON DELETE SET NULL,
    "instruction" text NOT NULL DEFAULT '',
    "record_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "total" integer NOT NULL DEFAULT 0,
    "dispatched" integer NOT NULL DEFAULT 0,
    "status" varchar(12) NOT NULL DEFAULT 'running',
    "stopped_reason" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "finished_at" timestamptz,
    CONSTRAINT "ai_agent_batches_status_chk" CHECK ("status" IN ('running', 'done', 'stopped', 'cancelled'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_batches_tenant_ix" ON "ai_agent_batches" ("tenant_id", "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_batches_agent_ix" ON "ai_agent_batches" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_batches_list_ix" ON "ai_agent_batches" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_batches_created_by_ix" ON "ai_agent_batches" ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_batches_running_ix" ON "ai_agent_batches" ("status") WHERE "status" = 'running';--> statement-breakpoint
ALTER TABLE "ai_agent_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_agent_batches" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_agent_batches"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_agent_batches" TO imagina_app;--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ADD COLUMN IF NOT EXISTS "batch_id" bigint REFERENCES "ai_agent_batches"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_runs_batch_ix" ON "ai_agent_runs" ("batch_id") WHERE "batch_id" IS NOT NULL;
