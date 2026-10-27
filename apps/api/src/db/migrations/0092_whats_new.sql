-- Fase 7 · entrega 3 — Novedades (ADR-S74).
--
-- `whats_new_entries`: una novedad de la PLATAFORMA (sin `tenant_id`, como
-- `plans`: la leen todas las empresas). `origin` = `release` (viene escrita en
-- el código con la versión y el servidor la sincroniza al arrancar) u
-- `operator` (la escribe el operador en Plataforma → Novedades). `key` es la
-- clave estable del catálogo (única: varios nodos sincronizando a la vez no
-- duplican). `announce_from` = desde cuándo cuenta como «nueva» en ESTE
-- servidor (null = sólo historial); `published_at` es la fecha que se muestra
-- y la puerta de visibilidad (una programada se ve desde ahí). `edited` marca
-- una novedad de versión que el operador cambió: la sincronización ya no la
-- toca. El público son dos listas (roles base y planes; vacías = todos).
--
-- `whats_new_views`: lo que vio cada PERSONA (global, no por empresa: una
-- novedad es de la plataforma y se lee una vez aunque la persona esté en
-- varias empresas). RLS por `app.user_id` (como `memberships_self`): una
-- persona sólo lee y marca lo suyo. Las estadísticas del operador se leen por
-- la conexión base. Cae con el usuario (ON DELETE CASCADE); borrar la cuenta
-- (que anonimiza y no borra la fila) la limpia a mano.
CREATE TABLE IF NOT EXISTS "whats_new_entries" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "key" varchar(120) NOT NULL,
    "origin" varchar(16) NOT NULL,
    "status" varchar(16) NOT NULL DEFAULT 'published',
    "kind" varchar(16) NOT NULL,
    "title" varchar(200) NOT NULL,
    "summary" varchar(400) NOT NULL,
    "body" text NOT NULL DEFAULT '',
    "image_url" text,
    "video_url" text,
    "action" jsonb,
    "version" varchar(32),
    "featured" boolean NOT NULL DEFAULT false,
    "audience_roles" text[] NOT NULL DEFAULT '{}',
    "audience_plans" text[] NOT NULL DEFAULT '{}',
    "published_at" timestamptz,
    "announce_from" timestamptz,
    "expires_at" timestamptz,
    "edited" boolean NOT NULL DEFAULT false,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "updated_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "whats_new_entries_key_ux" UNIQUE ("key"),
    CONSTRAINT "whats_new_entries_origin_ck" CHECK ("origin" IN ('release', 'operator')),
    CONSTRAINT "whats_new_entries_status_ck" CHECK ("status" IN ('draft', 'published', 'hidden')),
    CONSTRAINT "whats_new_entries_kind_ck" CHECK ("kind" IN ('feature', 'improvement', 'fix', 'notice'))
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whats_new_entries_feed_ix" ON "whats_new_entries" ("published_at" DESC, "id" DESC) WHERE "status" = 'published';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whats_new_entries_created_by_ix" ON "whats_new_entries" ("created_by");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whats_new_entries_updated_by_ix" ON "whats_new_entries" ("updated_by");--> statement-breakpoint
-- Sólo lectura para el rol de la app: las novedades las escriben la
-- sincronización y la consola del operador por la conexión base, nunca código
-- con scope de empresa.
REVOKE INSERT, UPDATE, DELETE ON "whats_new_entries" FROM imagina_app;--> statement-breakpoint
GRANT SELECT ON "whats_new_entries" TO imagina_app;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "whats_new_views" (
    "user_id" bigint NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
    "entry_id" bigint NOT NULL REFERENCES "whats_new_entries" ("id") ON DELETE CASCADE,
    "seen_at" timestamptz,
    "opened_at" timestamptz,
    "clicked_at" timestamptz,
    "dismissed_at" timestamptz,
    "presented_at" timestamptz,
    CONSTRAINT "whats_new_views_pk" PRIMARY KEY ("user_id", "entry_id")
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "whats_new_views_entry_ix" ON "whats_new_views" ("entry_id");--> statement-breakpoint
ALTER TABLE "whats_new_views" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "whats_new_views" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "whats_new_views_self" ON "whats_new_views"
    USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::bigint)
    WITH CHECK ("user_id" = NULLIF(current_setting('app.user_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "whats_new_views" TO imagina_app;
