-- D5 — Agenda de citas pública (estilo Calendly).
--
-- `booking_pages`: la página pública de una lista (servicios, quién atiende,
-- disponibilidad, reglas y el mapeo a los campos de la lista en `config`). El
-- `token` es la dirección pública (único global): el endpoint público la
-- resuelve con la conexión base ANTES de conocer la empresa, como los
-- formularios (ADR-S39). RLS: dato de la empresa.
CREATE TABLE IF NOT EXISTS "booking_pages" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "name" varchar(120) NOT NULL,
    "token" varchar(64) NOT NULL,
    "enabled" boolean NOT NULL DEFAULT false,
    "config" jsonb NOT NULL,
    "bookings_count" integer NOT NULL DEFAULT 0,
    "last_booked_at" timestamptz,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booking_pages_token_ux" ON "booking_pages" ("token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_pages_list_ix" ON "booking_pages" ("tenant_id", "list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_pages_list_fk_ix" ON "booking_pages" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_pages_created_by_ix" ON "booking_pages" ("created_by");--> statement-breakpoint
ALTER TABLE "booking_pages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "booking_pages" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "booking_pages"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "booking_pages" TO imagina_app;--> statement-breakpoint

-- Cada cita reservada por una página: lo que el registro NO guarda y hace
-- falta para lo que pasa después — el enlace firmado para reprogramar o
-- cancelar (por id), los recordatorios ya enviados (dedup entre nodos), el
-- evento creado en el calendario de quien atiende y el correo del cliente.
-- El registro sigue siendo la verdad de la cita: `start_at`/`end_at`/`status`
-- son una copia que se mantiene al día cuando el equipo la edita (los
-- recordatorios se buscan por `start_at` sin leer el jsonb de cada lista).
CREATE TABLE IF NOT EXISTS "booking_appointments" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "page_id" bigint NOT NULL REFERENCES "booking_pages" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "staff_id" varchar(24) NOT NULL,
    "staff_user_id" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "service_id" varchar(24) NOT NULL,
    "start_at" timestamptz NOT NULL,
    "end_at" timestamptz NOT NULL,
    "status" varchar(12) NOT NULL DEFAULT 'confirmed',
    "client_name" varchar(300),
    "client_email" varchar(320),
    "client_tz" varchar(64),
    "external_event" jsonb,
    "reminders_sent" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "cancelled_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "booking_appointments_status_ck" CHECK ("status" IN ('confirmed', 'rescheduled', 'cancelled'))
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "booking_appointments_record_ux" ON "booking_appointments" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_appointments_page_ix" ON "booking_appointments" ("tenant_id", "page_id", "start_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_appointments_page_fk_ix" ON "booking_appointments" ("page_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_appointments_list_ix" ON "booking_appointments" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_appointments_staff_user_ix" ON "booking_appointments" ("staff_user_id");--> statement-breakpoint
-- Recordatorios: sólo las citas vivas, por inicio (el barrido de cada minuto).
CREATE INDEX IF NOT EXISTS "booking_appointments_upcoming_ix" ON "booking_appointments" ("start_at") WHERE "status" <> 'cancelled';--> statement-breakpoint
ALTER TABLE "booking_appointments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "booking_appointments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "booking_appointments"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "booking_appointments" TO imagina_app;
