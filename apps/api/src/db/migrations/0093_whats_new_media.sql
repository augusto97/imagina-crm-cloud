-- v0.1.325 — Novedades con ilustración animada, captura real y carrusel
-- (ADR-S78). Una sola columna jsonb `{ illustration, demo, slides[] }`
-- validada con `whatsNewMediaSchema` (packages/shared): son claves de las
-- ilustraciones y capturas de la app, no HTML ni archivos. La sincronización
-- del catálogo la completa para las novedades que ya estaban publicadas (las
-- que el operador no editó).
ALTER TABLE "whats_new_entries" ADD COLUMN IF NOT EXISTS "media" jsonb NOT NULL DEFAULT '{}'::jsonb;
