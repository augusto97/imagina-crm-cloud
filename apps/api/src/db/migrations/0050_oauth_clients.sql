-- v0.1.184 (ADR-S21 fase 4) — OAuth 2.1 para el servidor MCP: los clientes
-- que se registran solos (RFC 7591: claude.ai, Claude Desktop, Cursor…) y los
-- tokens que emite el flujo "Autorizar", que viven en la MISMA tabla que los
-- tokens personales (misma resolución, misma revocación, misma bitácora) con
-- un refresh token rotativo.
--
-- SIN RLS (mismo patrón que personal_access_tokens): la búsqueda es por
-- client_id / hash antes de conocer el tenant.
CREATE TABLE IF NOT EXISTS "oauth_clients" (
    "client_id" varchar(64) PRIMARY KEY,
    "client_secret_hash" varchar(64),
    "client_name" text NOT NULL,
    "redirect_uris" jsonb NOT NULL DEFAULT '[]'::jsonb,
    "token_endpoint_auth_method" varchar(24) NOT NULL DEFAULT 'none',
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "last_used_at" timestamptz
);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "oauth_clients" TO imagina_app;--> statement-breakpoint

ALTER TABLE "personal_access_tokens" ADD COLUMN IF NOT EXISTS "client_id" varchar(64);--> statement-breakpoint
ALTER TABLE "personal_access_tokens" ADD COLUMN IF NOT EXISTS "refresh_token_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "personal_access_tokens" ADD COLUMN IF NOT EXISTS "refresh_expires_at" timestamptz;--> statement-breakpoint
DO $$ BEGIN
    ALTER TABLE "personal_access_tokens" ADD CONSTRAINT "personal_access_tokens_client_fk"
        FOREIGN KEY ("client_id") REFERENCES "oauth_clients"("client_id") ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "personal_access_tokens_refresh_ux" ON "personal_access_tokens" ("refresh_token_hash");
