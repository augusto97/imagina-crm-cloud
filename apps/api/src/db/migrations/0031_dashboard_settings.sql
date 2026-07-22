-- v0.1.98 — Ajustes por dashboard (página: fondo/ancho/tipografía, y claves
-- futuras). jsonb permisivo, mismo patrón que lists.settings.
ALTER TABLE "dashboards" ADD COLUMN IF NOT EXISTS "settings" jsonb NOT NULL DEFAULT '{}'::jsonb;
