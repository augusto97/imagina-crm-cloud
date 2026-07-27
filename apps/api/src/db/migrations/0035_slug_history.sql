-- v0.1.117 — Historial de slugs de listas.
--
-- El slug es una etiqueta HUMANA editable (regla de oro nº 1): al renombrarlo,
-- todo enlace o marcador guardado con el slug viejo daba 404. Acá se registra
-- cada slug abandonado para poder resolverlo al id actual.
--
-- Un slug viejo se "libera" si otra lista lo reclama: por eso la fila se borra
-- cuando alguien vuelve a usarlo (lo maneja el service), y el índice único es
-- por (tenant, slug) — dentro de una empresa, un slug apunta a una sola lista.
CREATE TABLE IF NOT EXISTS "list_slug_history" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id"),
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "slug" varchar(64) NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "list_slug_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "list_slug_history" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "list_slug_history"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint

CREATE UNIQUE INDEX "list_slug_history_slug_ux" ON "list_slug_history" ("tenant_id", "slug");
