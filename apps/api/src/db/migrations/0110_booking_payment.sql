-- v0.1.387 — Cobrar al agendar: la cita recuerda su link de pago y, si tiene
-- que pagarse para confirmarla, hasta cuándo queda apartado el horario. Si el
-- equipo la marca pagada a mano (pagó por otro medio), quién y cuándo.
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "payment_link_id" bigint;--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "payment_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "paid_marked_by" bigint;--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD COLUMN IF NOT EXISTS "paid_marked_at" timestamp with time zone;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "booking_appointments" ADD CONSTRAINT "booking_appointments_paid_marked_by_fk" FOREIGN KEY ("paid_marked_by") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_appointments_paid_marked_by_ix" ON "booking_appointments" ("paid_marked_by") WHERE "paid_marked_by" IS NOT NULL;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "booking_appointments" ADD CONSTRAINT "booking_appointments_payment_link_fk" FOREIGN KEY ("payment_link_id") REFERENCES "payment_links"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_appointments_payment_link_ix" ON "booking_appointments" ("payment_link_id") WHERE "payment_link_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "booking_appointments_unpaid_ix" ON "booking_appointments" ("payment_until") WHERE "status" = 'unpaid';--> statement-breakpoint
ALTER TABLE "booking_appointments" DROP CONSTRAINT IF EXISTS "booking_appointments_status_ck";--> statement-breakpoint
ALTER TABLE "booking_appointments" ADD CONSTRAINT "booking_appointments_status_ck" CHECK ("status" IN ('confirmed', 'rescheduled', 'cancelled', 'pending', 'declined', 'unpaid'));
