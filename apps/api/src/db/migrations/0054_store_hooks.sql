-- v0.1.207 (ADR-S24 fase 3) — Avisos en tiempo real de una tienda.
--
-- La tienda (WooCommerce) llama a `POST /public/store-hooks/:token` cada vez
-- que cambia un pedido, un producto o un cliente. El token opaco dice a qué
-- sincronización va el aviso y el SECRETO (cifrado con SECRETS_KEY) verifica
-- la firma HMAC que la tienda manda en cada entrega. SIN RLS a propósito —
-- mismo patrón que `automation_hooks` y `public_lists`: al recibir el aviso
-- todavía no se sabe de qué empresa es; lo dice esta fila, y el aviso se
-- procesa después dentro del scope de ese tenant.
CREATE TABLE IF NOT EXISTS "store_hooks" (
    "token" varchar(64) PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "sync_id" bigint NOT NULL REFERENCES "connection_syncs" ("id") ON DELETE CASCADE,
    "secret_enc" text NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint
CREATE UNIQUE INDEX "store_hooks_sync_ux" ON "store_hooks" ("sync_id");
