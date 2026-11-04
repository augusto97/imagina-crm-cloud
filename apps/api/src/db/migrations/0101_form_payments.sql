-- v0.1.361 — Formularios que cobran al enviar.
--
-- `payment_links.reference`: la referencia nuestra (`ib_…`) con la que se armó
-- el link. Es aleatoria e imposible de adivinar, y es lo que viaja en la
-- dirección de vuelta del checkout (`?pago=<referencia>`): con ella la página
-- del formulario muestra cómo quedó ESE pago y nada más.
-- `payment_links.form_id`: el formulario que armó el link (null = la ficha,
-- una automatización o el portal).
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "reference" varchar(64);--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "form_id" bigint REFERENCES "forms" ("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "payment_links_reference_ux" ON "payment_links" ("reference") WHERE "reference" IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_links_form_ix" ON "payment_links" ("tenant_id", "form_id") WHERE "form_id" IS NOT NULL;
