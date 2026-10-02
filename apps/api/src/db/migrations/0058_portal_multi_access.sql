-- v0.1.241 — Varios accesos al portal por persona dentro de una empresa.
--
-- Hasta acá `portal_links` era único por (usuario, empresa): darle acceso al
-- portal a alguien que ya lo tenía en OTRO registro de la misma empresa
-- REEMPLAZABA en silencio el vínculo anterior (el cliente dejaba de ver su
-- primer registro sin que nadie se enterara). Ahora una persona puede tener
-- un acceso por REGISTRO —una por cada empresa, contrato o proyecto suyo— y
-- elige cuál ver desde el portal. Lo que sigue siendo único es el par
-- (usuario, registro): dar el mismo acceso dos veces no duplica nada.
DROP INDEX IF EXISTS "portal_links_user_tenant_ux";
CREATE UNIQUE INDEX IF NOT EXISTS "portal_links_user_record_ux" ON "portal_links" USING btree ("user_id","record_id");
CREATE INDEX IF NOT EXISTS "portal_links_user_tenant_idx" ON "portal_links" USING btree ("user_id","tenant_id");
