-- v0.1.188 — Texto plano de la descripción del registro, para BUSCAR.
--
-- La descripción es un árbol ProseMirror en `records.description` (jsonb).
-- El buscador de la tabla sólo miraba los campos de datos, así que lo escrito
-- en el cuerpo del registro era invisible para la búsqueda. Esta columna
-- GENERADA concatena todos los nodos de texto del documento (a cualquier
-- profundidad: columnas, listas, tablas) y se mantiene sola en cada escritura
-- — el código de la app no la toca. El índice trigram es el mismo que usan
-- los campos de texto indexados (ILIKE %needle%).
CREATE OR REPLACE FUNCTION imagina_richdoc_text(doc jsonb) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT CASE
        WHEN doc IS NULL THEN NULL
        ELSE nullif(
            array_to_string(
                ARRAY(SELECT jsonb_array_elements_text(jsonb_path_query_array(doc, 'strict $.**.text'))),
                ' '
            ),
            ''
        )
    END
$$;--> statement-breakpoint
ALTER TABLE "records" ADD COLUMN "description_text" text GENERATED ALWAYS AS (imagina_richdoc_text("description")) STORED;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "records_description_text_trgm_idx" ON "records" USING gin ("description_text" gin_trgm_ops);
