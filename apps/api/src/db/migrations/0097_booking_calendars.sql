-- v0.1.350 — Agenda de citas: el enlace de la videollamada de cada cita.
--
-- `meeting_url`: el enlace de Google Meet o Microsoft Teams que se generó en
-- el evento del calendario de quien atiende, o el enlace fijo del servicio o
-- de la persona. `meeting_provider`: 'meet' | 'teams' | 'link'. Se guardan en
-- la cita (y no sólo en el registro) porque el correo, el .ics, los
-- recordatorios y la página de la cita los muestran aunque la lista no tenga
-- un campo para el enlace.
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "meeting_url" text;--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "meeting_provider" varchar(16);--> statement-breakpoint
-- La sincronización con el calendario recorre las citas que tienen evento.
CREATE INDEX IF NOT EXISTS "booking_appointments_external_ix" ON "booking_appointments" ("start_at") WHERE "external_event" IS NOT NULL AND "status" <> 'cancelled';
