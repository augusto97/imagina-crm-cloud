-- v0.1.260 — opciones de la pestaña de una vista (estilo ClickUp): quién la
-- creó, privada (sólo su creador la ve), protegida (sólo su creador o un admin
-- la cambia) y guardado automático de los cambios.
ALTER TABLE saved_views ADD COLUMN IF NOT EXISTS created_by bigint REFERENCES users(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE saved_views ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE saved_views ADD COLUMN IF NOT EXISTS is_locked boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE saved_views ADD COLUMN IF NOT EXISTS autosave boolean NOT NULL DEFAULT false;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS saved_views_created_by_idx ON saved_views (created_by) WHERE created_by IS NOT NULL;
