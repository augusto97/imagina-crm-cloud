-- v0.1.107 — preferencias por usuario+workspace (favoritos del menú).
ALTER TABLE "memberships" ADD COLUMN IF NOT EXISTS "settings" jsonb NOT NULL DEFAULT '{}'::jsonb;
