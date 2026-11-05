-- v0.1.373 (addendum ADR-S96) — Suscripciones con PayPal. PayPal exige un
-- producto y un plan propios antes de suscribir: la app los crea la primera
-- vez y los recuerda aquí ({ product_id, plans: { "<forma>": "<plan_id>" } }).
ALTER TABLE "subscription_plans" ADD COLUMN IF NOT EXISTS "provider_refs" jsonb NOT NULL DEFAULT '{}'::jsonb;
