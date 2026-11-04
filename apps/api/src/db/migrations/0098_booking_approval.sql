-- v0.1.353 — Agenda de citas: aprobación y enlaces de un solo uso.
--
-- `pending_until`: una cita «por confirmar» (status = 'pending') ocupa el
-- lugar hasta esta hora; si nadie decide antes, vence (se rechaza o se
-- confirma, según la agenda). `decided_by`/`decided_at`/`decline_reason`:
-- quién la aprobó o rechazó, cuándo y por qué (el motivo le llega al
-- cliente). `manage_version`: va dentro de la firma del enlace de la cita;
-- cada cambio (reprogramar, cancelar, aprobar, rechazar) la sube, así el
-- enlace de un correo viejo ya no sirve para hacer cambios.
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "pending_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "decided_by" bigint REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "decided_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "decline_reason" varchar(500);--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "manage_version" integer NOT NULL DEFAULT 0;--> statement-breakpoint
-- El vencimiento de las por confirmar se barre cada minuto.
CREATE INDEX IF NOT EXISTS "booking_appointments_pending_ix" ON "booking_appointments" ("pending_until") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_appointments_decided_by_ix" ON "booking_appointments" ("decided_by");--> statement-breakpoint
-- Las citas que ya no ocupan el lugar son las canceladas y las rechazadas.
DROP INDEX IF EXISTS "booking_appointments_upcoming_ix";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_appointments_upcoming_ix" ON "booking_appointments" ("start_at") WHERE "status" NOT IN ('cancelled', 'declined');--> statement-breakpoint
-- Los estados nuevos: «por confirmar» y «rechazada».
ALTER TABLE "booking_appointments" DROP CONSTRAINT IF EXISTS "booking_appointments_status_ck";--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD CONSTRAINT "booking_appointments_status_ck" CHECK ("status" IN ('confirmed', 'rescheduled', 'cancelled', 'pending', 'declined'));--> statement-breakpoint
-- Lo que se sincroniza con el calendario tampoco cuenta las rechazadas.
DROP INDEX IF EXISTS "booking_appointments_external_ix";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_appointments_external_ix" ON "booking_appointments" ("start_at") WHERE "external_event" IS NOT NULL AND "status" NOT IN ('cancelled', 'declined');
