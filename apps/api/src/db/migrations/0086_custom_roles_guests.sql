-- C2 — Roles PROPIOS por empresa: parten de un rol base (manager / agent /
-- viewer) y ajustan sus capacidades por módulo. El rol base sigue mandando
-- para el acceso por defecto a cada lista y el alcance (todo / lo suyo); el
-- rol propio decide las CAPACIDADES. `admin` queda fijo.
CREATE TABLE IF NOT EXISTS "custom_roles" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "name" varchar(60) NOT NULL,
    "description" text,
    "color" varchar(32),
    "base_role" varchar(16) NOT NULL CHECK ("base_role" IN ('manager', 'agent', 'viewer')),
    "capabilities" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "custom_roles_tenant_name_ux" ON "custom_roles" ("tenant_id", lower("name"));--> statement-breakpoint
ALTER TABLE "custom_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "custom_roles" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "custom_roles"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
-- Borrar un rol propio deja a sus personas en su rol base.
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "custom_role_id" bigint
    REFERENCES "custom_roles" ("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "memberships_custom_role_ix" ON "memberships" ("custom_role_id") WHERE "custom_role_id" IS NOT NULL;--> statement-breakpoint
-- Cada persona LEE su propio rol propio sin empresa activa (el TenantGuard y
-- la sesión lo resuelven en la misma consulta que la membresía).
CREATE POLICY "custom_roles_self" ON "custom_roles" FOR SELECT
    USING ("id" IN (
        SELECT m."custom_role_id" FROM "memberships" m
        WHERE m."user_id" = NULLIF(current_setting('app.user_id', true), '')::bigint
    ));--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "custom_roles" TO imagina_app;--> statement-breakpoint

-- C3 — Invitados externos: rol `guest` en la membresía. (El valor nuevo no se
-- usa en esta misma migración: Postgres no deja usarlo antes del commit.)
ALTER TYPE "membership_role" ADD VALUE IF NOT EXISTS 'guest';--> statement-breakpoint

-- Registros sueltos compartidos con una persona de afuera (nivel ver /
-- comentar / editar). Un registro en la papelera no se comparte: la RLS de
-- `records` ya lo esconde y el acceso se resuelve contra registros vivos.
CREATE TABLE IF NOT EXISTS "record_shares" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "user_id" bigint NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
    "level" varchar(16) NOT NULL CHECK ("level" IN ('view', 'comment', 'edit')),
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "record_shares_record_user_ux" ON "record_shares" ("record_id", "user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_shares_user_ix" ON "record_shares" ("tenant_id", "user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_shares_list_ix" ON "record_shares" ("list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_shares_created_by_ix" ON "record_shares" ("created_by");--> statement-breakpoint
ALTER TABLE "record_shares" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_shares" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "record_shares"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "record_shares" TO imagina_app;--> statement-breakpoint

-- Tope de invitados por plan (no ocupan usuario). NULL = ilimitado.
ALTER TABLE "plans" ADD COLUMN IF NOT EXISTS "max_guests" integer;--> statement-breakpoint
UPDATE "plans" SET "max_guests" = 5 WHERE "slug" = 'trial' AND "max_guests" IS NULL;--> statement-breakpoint
UPDATE "plans" SET "max_guests" = 20 WHERE "slug" = 'starter' AND "max_guests" IS NULL;--> statement-breakpoint
UPDATE "plans" SET "max_guests" = 100 WHERE "slug" = 'pro' AND "max_guests" IS NULL;
