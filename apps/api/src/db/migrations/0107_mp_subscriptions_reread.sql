-- v0.1.380 (addendum ADR-S96) — Las suscripciones de Mercado Pago sin
-- ningún cobro registrado se vuelven a leer en la próxima revisión (unos
-- minutos después de actualizar), ahora con el resumen de cobros de Mercado
-- Pago y su nombre: antes quedaban «Vencida» aunque estuvieran pagando y se
-- habrían vuelto a leer recién al día siguiente.
UPDATE "subscriptions"
SET "last_checked_at" = NULL
WHERE "provider" = 'mercadopago'
  AND "charges_paid" = 0
  AND "external_id" IS NOT NULL
  AND "status" NOT IN ('cancelled', 'finished');
