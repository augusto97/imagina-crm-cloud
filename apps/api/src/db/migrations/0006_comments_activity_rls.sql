-- RLS para comments y activity (mismo patrón que el resto — ADR-S04).

ALTER TABLE "comments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "comments" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "comments"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
CREATE INDEX "comments_record_idx" ON "comments" ("tenant_id", "record_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint

ALTER TABLE "activity" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "activity" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "activity"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
CREATE INDEX "activity_record_idx" ON "activity" ("tenant_id", "record_id");--> statement-breakpoint
CREATE INDEX "activity_list_idx" ON "activity" ("tenant_id", "list_id");
