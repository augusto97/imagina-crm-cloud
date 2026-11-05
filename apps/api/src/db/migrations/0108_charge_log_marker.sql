-- v0.1.383 — Las columnas que escribe el registro de cobros de las
-- suscripciones (v0.1.371) quedan protegidas: la lista DESTINO lleva una marca
-- con la lista de suscriptores que la escribe y sus columnas. Se rellena para
-- las configuraciones que ya existían; desde ahora la mantiene el servicio.
UPDATE "lists" AS d
SET "settings" = jsonb_set(
    coalesce(d."settings", '{}'::jsonb),
    '{subscription_charge_log_of}',
    jsonb_build_object(
        'list_id', s."id",
        'record_field_id', CASE WHEN jsonb_typeof(s."settings" -> 'subscription_charges' -> 'fields' -> 'record') = 'number'
            THEN s."settings" -> 'subscription_charges' -> 'fields' -> 'record' ELSE 'null'::jsonb END,
        'field_ids', (
            SELECT coalesce(jsonb_agg(e.value), '[]'::jsonb)
            FROM jsonb_each(s."settings" -> 'subscription_charges' -> 'fields') AS e
            WHERE e.key <> 'record' AND jsonb_typeof(e.value) = 'number'
        )
    )
)
FROM "lists" AS s
WHERE s."tenant_id" = d."tenant_id"
  AND s."deleted_at" IS NULL
  AND jsonb_typeof(s."settings" -> 'subscription_charges' -> 'list_id') = 'number'
  AND (s."settings" -> 'subscription_charges' ->> 'list_id')::bigint = d."id";
