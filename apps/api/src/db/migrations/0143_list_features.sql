-- v0.1.475 (ADR-S115) — «Funciones de la lista», según el uso.
--
-- Cada lista elige qué funciones de la ficha usa (`settings.features`). Las
-- que ya existían quedan como las usan: encendido lo que tienen (subtareas,
-- checklists, dependencias, registro de tiempo) y apagado lo vacío. La
-- descripción y el resumen con IA quedan encendidos (son la base de toda
-- lista). El aviso de duplicados sólo queda encendido donde alguien eligió
-- sus reglas a mano: con las reglas sugeridas avisaba en cualquier lista con
-- un correo o un teléfono, también en las que se repiten a propósito.
--
-- No borra nada: apagar una función la esconde; encenderla la trae de vuelta.
-- Se cuenta con lo que está en la papelera también (mejor dejar encendido de
-- más que esconderle algo a alguien). Sólo las listas que todavía no tienen
-- `features` (re-correr la migración no cambia lo que eligió nadie).
UPDATE "lists" l
SET "settings" = jsonb_set(
    coalesce(l."settings", '{}'::jsonb),
    '{features}',
    jsonb_build_object(
        'description', true,
        'ai_summary', true,
        'subtasks', EXISTS (
            SELECT 1 FROM "records" r
            WHERE r."tenant_id" = l."tenant_id" AND r."list_id" = l."id" AND r."parent_id" IS NOT NULL
        ),
        'checklists', EXISTS (
            SELECT 1 FROM "record_checklists" c
            WHERE c."tenant_id" = l."tenant_id" AND c."list_id" = l."id"
        ) OR EXISTS (
            SELECT 1 FROM "fields" f
            WHERE f."tenant_id" = l."tenant_id" AND f."list_id" = l."id" AND f."type" = 'checklist_progress'
        ),
        'dependencies', EXISTS (
            SELECT 1 FROM "record_dependencies" d
            WHERE d."tenant_id" = l."tenant_id" AND (d."blocker_list_id" = l."id" OR d."blocked_list_id" = l."id")
        ) OR coalesce(l."settings" ? 'dependencies', false),
        'time_tracking', EXISTS (
            SELECT 1 FROM "time_entries" t
            WHERE t."tenant_id" = l."tenant_id" AND t."list_id" = l."id"
        ) OR EXISTS (
            SELECT 1 FROM "fields" f
            WHERE f."tenant_id" = l."tenant_id" AND f."list_id" = l."id" AND f."type" = 'time_tracked'
        ),
        'duplicates', coalesce(jsonb_typeof(l."settings" -> 'duplicates' -> 'rules') = 'array', false)
            AND coalesce(l."settings" -> 'duplicates' ->> 'enabled', 'true') <> 'false'
    )
)
WHERE NOT (coalesce(l."settings", '{}'::jsonb) ? 'features');
