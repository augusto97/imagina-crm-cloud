-- v0.1.372 — PayPal como cobro de las empresas. Un link de PayPal es NUESTRO
-- (`/api/v1/public/pay/<referencia>`): al abrirlo se reusa la orden reciente o
-- se crea otra, porque una orden sin aprobar vence y PayPal no deja buscar las
-- órdenes de un link. El link recuerda las órdenes que creó (las últimas 10) y
-- adónde volver al pagar (la página del formulario que lo armó).

ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "provider_orders" jsonb NOT NULL DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN IF NOT EXISTS "return_url" text;
