-- v0.1.183 (ADR-S21 fase 3) — Tokens de acceso personal para el servidor MCP.
-- SIN RLS (mismo patrón que automation_hooks / public_lists): la búsqueda es
-- por hash del token antes de conocer el tenant. El secreto NO se guarda.
CREATE TABLE IF NOT EXISTS "personal_access_tokens" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "user_id" bigint NOT NULL,
    "tenant_id" bigint NOT NULL,
    "name" text NOT NULL,
    "prefix" varchar(16) NOT NULL,
    "token_hash" varchar(64) NOT NULL,
    "scope" varchar(8) NOT NULL DEFAULT 'read',
    "last_used_at" timestamptz,
    "expires_at" timestamptz,
    "revoked_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "personal_access_tokens_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
    CONSTRAINT "personal_access_tokens_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "personal_access_tokens_hash_ux" ON "personal_access_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "personal_access_tokens_user_idx" ON "personal_access_tokens" ("user_id", "tenant_id");--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "personal_access_tokens" TO imagina_app;
