-- v0.1.114 — Bitácora de acciones ADMINISTRATIVAS del workspace.
--
-- `activity` sólo registra cambios de REGISTROS y cuelga de una lista
-- (`list_id NOT NULL` + cascada), así que no sirve acá: borrar una lista
-- borraría justo la evidencia de quién la borró, y las acciones de workspace
-- (miembros, plan, SMTP, dominio) no tienen lista.
--
-- Append-only, tenant-scoped con RLS. `target_label` guarda el nombre que
-- tenía el objeto al momento de la acción: si después se borra, la bitácora
-- sigue siendo legible.
CREATE TABLE IF NOT EXISTS "audit_log" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id"),
    "user_id" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "action" varchar(64) NOT NULL,
    "target_type" varchar(32) NOT NULL DEFAULT '',
    "target_id" bigint,
    "target_label" text NOT NULL DEFAULT '',
    "meta" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "audit_log"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

CREATE INDEX "audit_log_tenant_idx" ON "audit_log" ("tenant_id", "id" DESC);
