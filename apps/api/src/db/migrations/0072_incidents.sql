-- v0.1.285 (ADR-S44) — Problemas de la empresa: algo que corre solo y dejó de
-- funcionar. Un problema ABIERTO por (empresa, key): las fallas repetidas de lo
-- mismo suman `count` en vez de crear filas nuevas.
CREATE TABLE IF NOT EXISTS "incidents" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "key" varchar(120) NOT NULL,
    "source" varchar(24) NOT NULL,
    "source_id" bigint,
    "list_id" bigint REFERENCES "lists" ("id") ON DELETE CASCADE,
    "owner_id" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "title" varchar(300) NOT NULL,
    "message" text NOT NULL DEFAULT '',
    "count" integer NOT NULL DEFAULT 1,
    "first_at" timestamptz NOT NULL DEFAULT now(),
    "last_at" timestamptz NOT NULL DEFAULT now(),
    "notified_at" timestamptz,
    "resolved_at" timestamptz,
    "resolved_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "incidents_open_key_ux" ON "incidents" ("tenant_id", "key") WHERE "resolved_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_tenant_ix" ON "incidents" ("tenant_id", "last_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_list_ix" ON "incidents" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_owner_ix" ON "incidents" ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "incidents_resolved_by_ix" ON "incidents" ("resolved_by");--> statement-breakpoint
ALTER TABLE "incidents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "incidents" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "incidents"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);
--> statement-breakpoint
-- La última corrida de cada automatización (índice de automatizaciones) sin
-- recorrer todo su historial.
CREATE INDEX IF NOT EXISTS "automation_runs_last_ix" ON "automation_runs" ("tenant_id", "automation_id", "id" DESC);
