-- v0.1.245 — Dominio propio del PORTAL DEL CLIENTE (white-label).
--
-- `custom_domain` (ADR-S17) es la entrada del EQUIPO a la app. Una empresa que
-- quiere que sus clientes vean SÓLO su marca necesita un dominio aparte para
-- ellos (`clientes.acme.com`) que abra directo el portal: el cliente nunca ve
-- el login del equipo. Mismo ciclo que el dominio del equipo (SEC-32): pedirlo
-- lo deja PENDIENTE en `settings.portal_domain_claim` y sólo se escribe acá
-- cuando aparece el TXT de verificación en su DNS. Único global, y nunca igual
-- al `custom_domain` de nadie (lo controla el servicio).
ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "portal_domain" varchar(253);
CREATE UNIQUE INDEX IF NOT EXISTS "tenants_portal_domain_unique" ON "tenants" ("portal_domain");
