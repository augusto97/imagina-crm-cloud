-- v0.1.445 (A14, ADR-S106) — Duplicados: pares marcados «no son duplicados».
--
-- Las reglas viven en `lists.settings.duplicates` (sin migración). Aquí sólo
-- queda lo que la persona decidió: estos dos registros NO son el mismo, así
-- no vuelven a aparecer juntos en el panel ni en el aviso. El par se guarda
-- ordenado (`record_low` < `record_high`) para que (a,b) y (b,a) sean uno.
CREATE TABLE IF NOT EXISTS "record_duplicate_dismissals" (
    "id" bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "tenant_id" bigint NOT NULL REFERENCES "tenants" ("id") ON DELETE CASCADE,
    "list_id" bigint NOT NULL REFERENCES "lists" ("id") ON DELETE CASCADE,
    "record_low" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "record_high" bigint NOT NULL REFERENCES "records" ("id") ON DELETE CASCADE,
    "created_by" bigint REFERENCES "users" ("id") ON DELETE SET NULL,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "record_duplicate_dismissals_order_ck" CHECK ("record_low" < "record_high")
);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "record_duplicate_dismissals_pair_ux" ON "record_duplicate_dismissals" ("record_low", "record_high");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_duplicate_dismissals_high_ix" ON "record_duplicate_dismissals" ("record_high");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_duplicate_dismissals_list_ix" ON "record_duplicate_dismissals" ("tenant_id", "list_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "record_duplicate_dismissals_created_by_ix" ON "record_duplicate_dismissals" ("created_by");--> statement-breakpoint
ALTER TABLE "record_duplicate_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "record_duplicate_dismissals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "record_duplicate_dismissals"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "record_duplicate_dismissals" TO imagina_app;
