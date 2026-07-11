-- Recurrencias ClickUp-style sobre un campo date/datetime de un record
-- (paridad con Recurrences/* del plugin). UNIQUE por (tenant, record, campo
-- de fecha): una recurrencia por celda — el POST hace upsert.
-- repeat_until / last_fired_at son TEXT: se comparan lexicográficamente
-- contra los valores de fecha del JSONB (estilo plugin), no timestamps.
CREATE TABLE IF NOT EXISTS "recurrences" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id"),
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "date_field_id" bigint NOT NULL REFERENCES "fields" ("id") ON DELETE CASCADE,
    "frequency" varchar(20) NOT NULL,
    "interval_n" integer NOT NULL DEFAULT 1,
    "monthly_pattern" varchar(20),
    "trigger_type" varchar(20) NOT NULL DEFAULT 'schedule',
    "trigger_status_field_id" bigint REFERENCES "fields" ("id") ON DELETE SET NULL,
    "trigger_status_value" text,
    "action_type" varchar(10) NOT NULL DEFAULT 'update',
    "update_status_field_id" bigint REFERENCES "fields" ("id") ON DELETE SET NULL,
    "update_status_value" text,
    "repeat_until" text,
    "last_fired_at" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "recurrences_record_field_unique" UNIQUE ("tenant_id", "record_id", "date_field_id")
);--> statement-breakpoint

ALTER TABLE "recurrences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recurrences" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "recurrences"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

CREATE INDEX "recurrences_tenant_record_idx" ON "recurrences" ("tenant_id", "record_id");--> statement-breakpoint
-- El tick global enumera las recurrencias trigger=schedule.
CREATE INDEX "recurrences_trigger_idx" ON "recurrences" ("trigger_type");
