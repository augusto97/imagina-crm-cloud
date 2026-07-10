-- Planes editables desde la consola de operador (ADR-S15 F3). Antes los límites
-- eran una constante (PLAN_LIMITS); ahora viven en DB. Global (sin RLS): es
-- config de plataforma, no dato de tenant. Se siembra con los 4 por defecto.
CREATE TABLE IF NOT EXISTS "plans" (
    "slug" varchar(32) PRIMARY KEY,
    "name" text NOT NULL,
    "max_records" integer,
    "max_users" integer,
    "max_automations" integer,
    "is_active" boolean NOT NULL DEFAULT true,
    "position" integer NOT NULL DEFAULT 0,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
INSERT INTO "plans" ("slug", "name", "max_records", "max_users", "max_automations", "position") VALUES
    ('trial', 'Trial', 500, 3, 3, 0),
    ('starter', 'Starter', 10000, 10, 20, 1),
    ('pro', 'Pro', 200000, 50, 200, 2),
    ('enterprise', 'Enterprise', NULL, NULL, NULL, 3)
ON CONFLICT ("slug") DO NOTHING;
