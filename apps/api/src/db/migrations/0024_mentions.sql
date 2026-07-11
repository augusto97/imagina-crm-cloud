-- Menciones (@usuario en comentarios — herencia del plugin). Cada mención es
-- una fila apuntando al usuario mencionado; la campana (`GET /me/mentions`)
-- las lista por usuario dentro del workspace activo. El "no leído" es
-- client-side (localStorage), así que no hay read_at. Tenant-scoped con RLS;
-- borrar el comment limpia en cascada.
CREATE TABLE IF NOT EXISTS "mentions" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id"),
    "comment_id" bigint NOT NULL REFERENCES "comments" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "record_id" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "mentioned_user_id" bigint NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
    "author_user_id" bigint NOT NULL REFERENCES "users" ("id"),
    "snippet" text NOT NULL DEFAULT '',
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "mentions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mentions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "mentions"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

CREATE INDEX "mentions_user_idx" ON "mentions" ("tenant_id", "mentioned_user_id", "id" DESC);
