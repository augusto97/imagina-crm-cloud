-- RLS para portal_links (ADR-S04). El vínculo lo lee el plano de portal con
-- el tenant activo del client; el WITH CHECK protege el alta.

ALTER TABLE "portal_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "portal_links" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "portal_links"
    USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint)
    WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::bigint);--> statement-breakpoint
-- El client lee su propio vínculo sin tenant activo (plano de portal).
CREATE POLICY "portal_links_self" ON "portal_links"
    USING ("user_id" = NULLIF(current_setting('app.user_id', true), '')::bigint);
