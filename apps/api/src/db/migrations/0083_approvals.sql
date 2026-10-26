-- C5 — Aprobaciones: flujos por lista, solicitudes por registro y decisiones.
--
-- `approval_flows` es configuración de la lista (pasos en serie, qué se pone
-- al resolver). Cada `approval_requests` guarda la COPIA de esa configuración
-- al momento de pedir (`config`): cambiar o borrar el flujo no altera las
-- pendientes. `approval_decisions` es una fila por persona y paso; el único
-- (request_id, step, user_id) impide que alguien apruebe dos veces el mismo
-- paso. A lo sumo UNA solicitud pendiente por registro y flujo (índice único
-- parcial). Las decisiones concurrentes se serializan con `FOR UPDATE` sobre
-- la solicitud (ver ApprovalsService.decide).
CREATE TABLE IF NOT EXISTS "approval_flows" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "name" varchar(120) NOT NULL,
    "description" text NOT NULL DEFAULT '',
    "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
    "is_active" boolean NOT NULL DEFAULT true,
    "position" integer NOT NULL DEFAULT 0,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_flows_list_ix" ON "approval_flows" ("tenant_id", "list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_flows_list_fk_ix" ON "approval_flows" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_flows_created_by_ix" ON "approval_flows" ("created_by");--> statement-breakpoint
ALTER TABLE "approval_flows" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approval_flows" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "approval_flows"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "approval_flows" TO imagina_app;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "approval_requests" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "flow_id" bigint REFERENCES "approval_flows" ("id") ON DELETE SET NULL,
    "flow_name" varchar(120) NOT NULL,
    "config" jsonb NOT NULL,
    "status" varchar(16) NOT NULL DEFAULT 'pending',
    "current_step" integer NOT NULL DEFAULT 0,
    "step_started_at" timestamptz NOT NULL DEFAULT now(),
    "note" text NOT NULL DEFAULT '',
    "source" varchar(16) NOT NULL DEFAULT 'user',
    "automation_id" bigint,
    "automation_name" varchar(190),
    "requested_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "requested_at" timestamptz NOT NULL DEFAULT now(),
    "resolved_at" timestamptz,
    "resolved_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "reason" text NOT NULL DEFAULT '',
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "approval_requests_status_ck" CHECK ("status" IN ('pending', 'approved', 'rejected', 'returned', 'cancelled')),
    CONSTRAINT "approval_requests_source_ck" CHECK ("source" IN ('user', 'automation'))
);--> statement-breakpoint
-- Una pendiente por registro y flujo.
CREATE UNIQUE INDEX IF NOT EXISTS "approval_requests_one_pending_ux" ON "approval_requests" ("record_id", "flow_id") WHERE "status" = 'pending';--> statement-breakpoint
-- La última solicitud de un registro (el campo «Aprobación» y la ficha).
CREATE INDEX IF NOT EXISTS "approval_requests_record_ix" ON "approval_requests" ("record_id", "id" DESC);--> statement-breakpoint
-- La bandeja «Mi trabajo» recorre sólo las pendientes de la empresa.
CREATE INDEX IF NOT EXISTS "approval_requests_pending_ix" ON "approval_requests" ("tenant_id", "id") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_list_ix" ON "approval_requests" ("tenant_id", "list_id", "status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_list_fk_ix" ON "approval_requests" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_flow_ix" ON "approval_requests" ("flow_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_requested_by_ix" ON "approval_requests" ("tenant_id", "requested_by", "id" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_requested_by_fk_ix" ON "approval_requests" ("requested_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_requests_resolved_by_ix" ON "approval_requests" ("resolved_by");--> statement-breakpoint
ALTER TABLE "approval_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approval_requests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "approval_requests"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "approval_requests" TO imagina_app;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "approval_decisions" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "request_id" bigint NOT NULL REFERENCES "approval_requests" ("id") ON DELETE CASCADE,
    "step" integer NOT NULL,
    "user_id" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "decision" varchar(10) NOT NULL,
    "reason" text NOT NULL DEFAULT '',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "approval_decisions_decision_ck" CHECK ("decision" IN ('approve', 'reject', 'return')),
    CONSTRAINT "approval_decisions_once_ux" UNIQUE ("request_id", "step", "user_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_decisions_user_ix" ON "approval_decisions" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "approval_decisions_tenant_ix" ON "approval_decisions" ("tenant_id");--> statement-breakpoint
ALTER TABLE "approval_decisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "approval_decisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "approval_decisions"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "approval_decisions" TO imagina_app;--> statement-breakpoint

-- Papelera (ADR-S52): un registro que va a la papelera CANCELA sus solicitudes
-- pendientes, en la misma transacción y por TODOS los caminos de borrado (uno,
-- en lote, por filtro, la lista entera, sus subtareas) sin tocar cada uno.
-- Restaurarlo NO las revive: lo que se aprobaba pudo cambiar mientras estaba
-- en la papelera, y quien lo borró pudo querer justamente abandonar el pedido.
-- Se pide de nuevo desde la ficha.
CREATE OR REPLACE FUNCTION imcrm_approvals_on_record_trash() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    UPDATE approval_requests
       SET status = 'cancelled',
           resolved_at = now(),
           updated_at = now(),
           reason = 'El registro se envió a la papelera.'
     WHERE record_id = NEW.id AND status = 'pending';
    RETURN NULL;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "records_approvals_trash" ON "records";--> statement-breakpoint
CREATE TRIGGER "records_approvals_trash" AFTER UPDATE OF "deleted_at" ON "records"
    FOR EACH ROW WHEN (OLD."deleted_at" IS NULL AND NEW."deleted_at" IS NOT NULL)
    EXECUTE FUNCTION imcrm_approvals_on_record_trash();
