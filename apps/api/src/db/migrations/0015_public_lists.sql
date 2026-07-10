-- Listas públicas embebibles: mapeo token → lista (SIN RLS, índice público).
CREATE TABLE IF NOT EXISTS "public_lists" (
    "token" varchar(64) PRIMARY KEY,
    "tenant_id" bigint NOT NULL,
    "list_id" bigint NOT NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "public_lists_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id"),
    CONSTRAINT "public_lists_list_fk" FOREIGN KEY ("list_id") REFERENCES "lists"("id")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "public_lists_list_ux" ON "public_lists" ("tenant_id", "list_id");
