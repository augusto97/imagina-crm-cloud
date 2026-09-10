-- v0.1.173 — Icono y color por carpeta del menú (estilo ClickUp).
--
-- Mismo catálogo y mismas reglas que `lists.icon` / `lists.color`: se guarda
-- la CLAVE del icono (nunca el componente) y el color en hex. Nullable: una
-- carpeta sin elección muestra el icono genérico de carpeta.
ALTER TABLE "list_groups" ADD COLUMN IF NOT EXISTS "icon" text;--> statement-breakpoint
ALTER TABLE "list_groups" ADD COLUMN IF NOT EXISTS "color" text;
