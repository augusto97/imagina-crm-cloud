-- v0.1.259 — icono y color de la pestaña de cada vista + orden explícito.
-- Hasta acá la barra ponía la vista por defecto PRIMERO y después ordenaba
-- por posición; ahora manda sólo la posición (se reordena arrastrando). Para
-- que nadie vea sus pestañas cambiar de lugar, se fija como posición el orden
-- que se mostraba.
ALTER TABLE saved_views ADD COLUMN IF NOT EXISTS icon text;
--> statement-breakpoint
ALTER TABLE saved_views ADD COLUMN IF NOT EXISTS color text;
--> statement-breakpoint
UPDATE saved_views v
SET position = s.rn
FROM (
    SELECT id, (row_number() OVER (PARTITION BY list_id ORDER BY is_default DESC, position, id) - 1)::int AS rn
    FROM saved_views
) s
WHERE s.id = v.id AND v.position <> s.rn;
