-- v0.1.291 — Mejoras de la ficha del registro: reacciones e hilos en los
-- comentarios, registro de tiempo y el historial por campo.

-- Reacciones con emoji a un comentario: una por (comentario, persona, emoji)
-- — tocar el mismo emoji otra vez la quita.
CREATE TABLE IF NOT EXISTS "comment_reactions" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "comment_id" bigint NOT NULL REFERENCES "comments" ("id") ON DELETE CASCADE,
    "user_id" bigint NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
    "emoji" varchar(16) NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "comment_reactions_ux" ON "comment_reactions" ("comment_id", "user_id", "emoji");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_reactions_user_ix" ON "comment_reactions" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_reactions_tenant_ix" ON "comment_reactions" ("tenant_id");--> statement-breakpoint
ALTER TABLE "comment_reactions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comment_reactions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "comment_reactions"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "comment_reactions" TO imagina_app;--> statement-breakpoint

-- Las respuestas de un comentario (hilos de un nivel) y el «Comentario
-- eliminado» que se conserva mientras tenga respuestas.
CREATE INDEX IF NOT EXISTS "comments_parent_ix" ON "comments" ("parent_id") WHERE "parent_id" IS NOT NULL;--> statement-breakpoint

-- Registro de tiempo por registro. `source = 'timer'` con `ended_at` NULL es
-- un cronómetro en curso (uno por persona en toda la empresa); al detenerlo se
-- guardan los segundos. Una entrada manual no tiene inicio ni fin: sólo la
-- fecha de trabajo y la duración. `seconds` de un cronómetro en curso es 0,
-- así la suma por registro no necesita filtrar.
CREATE TABLE IF NOT EXISTS "time_entries" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "user_id" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "source" varchar(8) NOT NULL DEFAULT 'manual',
    "work_date" date NOT NULL,
    "started_at" timestamptz,
    "ended_at" timestamptz,
    "seconds" integer NOT NULL DEFAULT 0,
    "note" varchar(500) NOT NULL DEFAULT '',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
-- La suma por registro (campo «Tiempo registrado») sale del índice solo.
CREATE INDEX IF NOT EXISTS "time_entries_record_ix" ON "time_entries" ("record_id", "seconds");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "time_entries_running_ux" ON "time_entries" ("tenant_id", "user_id") WHERE "source" = 'timer' AND "ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_list_ix" ON "time_entries" ("list_id", "work_date");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_user_ix" ON "time_entries" ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "time_entries_tenant_ix" ON "time_entries" ("tenant_id");--> statement-breakpoint
ALTER TABLE "time_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "time_entries" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "time_entries"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "time_entries" TO imagina_app;--> statement-breakpoint

-- Historial por campo: la actividad de UN registro de lo más nuevo a lo más
-- viejo (el feed y «Ver historial» de un campo, que filtra `diff ? 'fN'`)
-- recorre el índice en orden y corta en el LIMIT.
CREATE INDEX IF NOT EXISTS "activity_record_id_ix" ON "activity" ("tenant_id", "record_id", "id" DESC);--> statement-breakpoint
DROP INDEX IF EXISTS "activity_record_idx";
