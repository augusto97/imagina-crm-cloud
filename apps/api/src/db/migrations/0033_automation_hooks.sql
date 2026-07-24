-- v0.1.110 — Webhook entrante: mapeo token → automatización (SIN RLS,
-- índice público de tokens opacos, mismo patrón que public_lists).
CREATE TABLE IF NOT EXISTS "automation_hooks" (
    "token" varchar(64) PRIMARY KEY,
    "tenant_id" bigint NOT NULL,
    "automation_id" bigint NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "automation_hooks_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id"),
    CONSTRAINT "automation_hooks_automation_fk" FOREIGN KEY ("automation_id") REFERENCES "automations"("id") ON DELETE CASCADE
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "automation_hooks_automation_ux" ON "automation_hooks" ("automation_id");
