-- C1 — Equipos: grupos de personas del EQUIPO de trabajo («Ventas»,
-- «Soporte»). Sirven para asignar un registro a un equipo (campo «Equipo»,
-- que guarda un array de ids en `records.data`), dar acceso a una lista a un
-- equipo (`lists.settings.permissions.teams`), mencionar a @equipo y «De mis
-- equipos» en «Mi trabajo». Nombre único por empresa (sin mayúsculas): el
-- import y el pegar resuelven el equipo por nombre.
CREATE TABLE IF NOT EXISTS "teams" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "name" varchar(80) NOT NULL,
    "description" text,
    "icon" varchar(64),
    "color" varchar(32),
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "teams_tenant_name_ux" ON "teams" ("tenant_id", lower("name"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "teams_created_by_ix" ON "teams" ("created_by");--> statement-breakpoint
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "teams"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "teams" TO imagina_app;--> statement-breakpoint

-- Personas de cada equipo. `team_members_self` (sólo LECTURA) deja que el
-- TenantGuard lea los equipos de quien pide en la misma consulta que su
-- membresía (todavía sin empresa activa), como `memberships_self`.
CREATE TABLE IF NOT EXISTS "team_members" (
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "team_id" bigint NOT NULL REFERENCES "teams" ("id") ON DELETE CASCADE,
    "user_id" bigint NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
    "is_lead" boolean NOT NULL DEFAULT false,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY ("team_id", "user_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_members_user_ix" ON "team_members" ("tenant_id", "user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "team_members_user_only_ix" ON "team_members" ("user_id");--> statement-breakpoint
ALTER TABLE "team_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "team_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "team_members"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
CREATE POLICY "team_members_self" ON "team_members" FOR SELECT
    USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "team_members" TO imagina_app;
