-- v0.1.423 (addendum ADR-S103) — Dominio propio de la tienda.
--
-- Una tienda puede atenderse en un dominio de la empresa (`tienda.acme.com`)
-- y sólo ahí se deja indexar en Google. Es único en toda la plataforma (un
-- dominio sirve a una sola tienda); que no choque con el dominio del equipo
-- o del portal de ninguna empresa lo controla el servicio. El pedido sin
-- verificar vive en `settings.domain_claim` (SEC-32: pedir no es tener).
ALTER TABLE "shops" ADD COLUMN IF NOT EXISTS "custom_domain" varchar(253);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "shops_custom_domain_ux" ON "shops" ("custom_domain") WHERE "custom_domain" IS NOT NULL;
