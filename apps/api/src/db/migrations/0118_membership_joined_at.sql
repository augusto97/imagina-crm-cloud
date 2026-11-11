-- SEC (auditoría 2026-11) — Sumar a una empresa una cuenta que YA existía no
-- le pide permiso a nadie. Para que esa membresía "forzada" no sirva para leer
-- datos de la persona (su nombre, su firma de correo), se recuerda cuándo la
-- persona ENTRÓ por primera vez a la empresa. NULL = la sumaron y todavía no
-- entró: su nombre no se muestra y su firma no se usa.
--
-- Las membresías de antes quedan como ya aceptadas (su fecha de alta).
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "joined_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
UPDATE "memberships" SET "joined_at" = "created_at" WHERE "joined_at" IS NULL;
