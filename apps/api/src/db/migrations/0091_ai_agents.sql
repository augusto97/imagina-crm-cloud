-- E6 — Agentes de IA (ADR-S67).
--
-- `ai_agents`: el agente (nombre, tarea, herramientas, modo, topes) y su DUEÑO
-- (`owner_id`): corre con el acceso de esa persona, intersectado con sus listas
-- (`ai_agent_lists`) y sus herramientas. Cuándo trabaja NO vive aquí: son
-- automatizaciones con la acción `ask_agent`.
-- `ai_agent_runs`: cada corrida con sus pasos (resumidos), tokens y estado.
-- `ai_agent_proposals`: en modo «propone», los cambios esperan aquí a que una
-- persona los aplique o descarte (el payload ya validado + lo que se ve).
-- `ai_agent_versions`: una foto por guardado (las últimas 30).
-- `activity.agent_id`: qué agente hizo (o propuso) una entrada de actividad.
CREATE TABLE IF NOT EXISTS "ai_agents" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "name" varchar(80) NOT NULL,
    "description" text NOT NULL DEFAULT '',
    "color" varchar(16),
    "icon" varchar(40),
    "instructions" text NOT NULL DEFAULT '',
    "tools" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "mode" varchar(10) NOT NULL DEFAULT 'propose',
    "settings" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "max_steps" integer NOT NULL DEFAULT 8,
    "max_runs_per_day" integer NOT NULL DEFAULT 200,
    "monthly_token_budget" bigint DEFAULT 2000000,
    "owner_id" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "is_active" boolean NOT NULL DEFAULT true,
    "paused_reason" text,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "ai_agents_mode_ck" CHECK ("mode" IN ('propose', 'act')),
    CONSTRAINT "ai_agents_steps_ck" CHECK ("max_steps" BETWEEN 1 AND 20)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agents_tenant_ix" ON "ai_agents" ("tenant_id", "id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agents_owner_ix" ON "ai_agents" ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agents_created_by_ix" ON "ai_agents" ("created_by");--> statement-breakpoint
ALTER TABLE "ai_agents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_agents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_agents"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_agents" TO imagina_app;--> statement-breakpoint

-- Las listas en las que trabaja. Una lista en la papelera queda oculta por la
-- RLS de `lists` (al leer se cruza con ella); borrada para siempre, se va.
CREATE TABLE IF NOT EXISTS "ai_agent_lists" (
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "agent_id" bigint NOT NULL REFERENCES "ai_agents" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    PRIMARY KEY ("agent_id", "list_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_lists_list_ix" ON "ai_agent_lists" ("tenant_id", "list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_lists_list_fk_ix" ON "ai_agent_lists" ("list_id");--> statement-breakpoint
ALTER TABLE "ai_agent_lists" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_agent_lists" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_agent_lists"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_agent_lists" TO imagina_app;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_agent_runs" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "agent_id" bigint NOT NULL REFERENCES "ai_agents" ("id") ON DELETE CASCADE,
    "list_id" bigint REFERENCES "lists" ("id") ON DELETE SET NULL,
    "record_id" bigint REFERENCES "records" ("id") ON DELETE SET NULL,
    -- La automatización que le pidió el trabajo: sin FK (se puede borrar) y con
    -- su nombre para el historial.
    "automation_id" bigint,
    "automation_name" varchar(190),
    "trigger_label" varchar(240) NOT NULL DEFAULT '',
    "status" varchar(12) NOT NULL DEFAULT 'queued',
    "simulated" boolean NOT NULL DEFAULT false,
    "mode" varchar(10) NOT NULL DEFAULT 'propose',
    "instruction" text NOT NULL DEFAULT '',
    "steps" jsonb NOT NULL DEFAULT '[]'::jsonb,
    -- Lo que viaja de la automatización al agente (la cadena anti-bucle).
    "context" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "summary" text NOT NULL DEFAULT '',
    "input_tokens" bigint NOT NULL DEFAULT 0,
    "output_tokens" bigint NOT NULL DEFAULT 0,
    "error" text,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "started_at" timestamptz,
    "finished_at" timestamptz,
    CONSTRAINT "ai_agent_runs_status_ck" CHECK ("status" IN ('queued', 'running', 'success', 'failed', 'skipped', 'stopped'))
);--> statement-breakpoint
-- Historial por agente y conteo de «corridas de hoy» / «tokens del mes».
CREATE INDEX IF NOT EXISTS "ai_agent_runs_agent_ix" ON "ai_agent_runs" ("tenant_id", "agent_id", "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_runs_agent_time_ix" ON "ai_agent_runs" ("agent_id", "created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_runs_record_ix" ON "ai_agent_runs" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_runs_list_ix" ON "ai_agent_runs" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_runs_created_by_ix" ON "ai_agent_runs" ("created_by");--> statement-breakpoint
ALTER TABLE "ai_agent_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_agent_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_agent_runs"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_agent_runs" TO imagina_app;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_agent_proposals" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "agent_id" bigint REFERENCES "ai_agents" ("id") ON DELETE SET NULL,
    "agent_name" varchar(80) NOT NULL DEFAULT '',
    "run_id" bigint REFERENCES "ai_agent_runs" ("id") ON DELETE SET NULL,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "status" varchar(12) NOT NULL DEFAULT 'pending',
    "summary" text NOT NULL DEFAULT '',
    -- El payload ya validado al proponer (se re-valida al aplicar) y lo que se ve.
    "changes" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "result" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "decided_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "decided_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "ai_agent_proposals_status_ck" CHECK ("status" IN ('pending', 'applied', 'discarded', 'failed'))
);--> statement-breakpoint
-- La tarjeta de la ficha: las pendientes de un registro.
CREATE INDEX IF NOT EXISTS "ai_agent_proposals_record_ix" ON "ai_agent_proposals" ("record_id", "id" DESC) WHERE "status" = 'pending';--> statement-breakpoint
-- «Mi trabajo»: las pendientes de la empresa.
CREATE INDEX IF NOT EXISTS "ai_agent_proposals_pending_ix" ON "ai_agent_proposals" ("tenant_id", "id" DESC) WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_proposals_agent_ix" ON "ai_agent_proposals" ("agent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_proposals_run_ix" ON "ai_agent_proposals" ("run_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_proposals_list_ix" ON "ai_agent_proposals" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_proposals_record_fk_ix" ON "ai_agent_proposals" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_proposals_decided_by_ix" ON "ai_agent_proposals" ("decided_by");--> statement-breakpoint
ALTER TABLE "ai_agent_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_agent_proposals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_agent_proposals"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_agent_proposals" TO imagina_app;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "ai_agent_versions" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "agent_id" bigint NOT NULL REFERENCES "ai_agents" ("id") ON DELETE CASCADE,
    "snapshot" jsonb NOT NULL,
    "author_id" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "note" text,
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_versions_agent_ix" ON "ai_agent_versions" ("agent_id", "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_versions_tenant_ix" ON "ai_agent_versions" ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_agent_versions_author_ix" ON "ai_agent_versions" ("author_id");--> statement-breakpoint
ALTER TABLE "ai_agent_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ai_agent_versions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "ai_agent_versions"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_agent_versions" TO imagina_app;--> statement-breakpoint

-- Qué agente hizo (o propuso) una entrada de actividad. Sin FK: el nombre se
-- resuelve al leer y un agente borrado se muestra como «Un agente de IA».
ALTER TABLE "activity" ADD COLUMN IF NOT EXISTS "agent_id" bigint;
