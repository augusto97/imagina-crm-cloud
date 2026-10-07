-- v0.1.257 — Se dejan de crear índices por campo (`is_indexed`).
--
-- Cada campo marcado como indexado sumaba 1-2 índices de expresión a la tabla
-- COMPARTIDA `records`. El planificador de Postgres los evalúa a todos en CADA
-- consulta sobre la tabla, de todas las empresas: medido con 890 índices, cada
-- consulta tardaba ~70 ms sólo en planificarse (0,6 ms sin ellos). Y no
-- aceleraban nada medible: en una lista de 100k registros un filtro tarda
-- 20-35 ms con o sin el índice, porque el índice de la lista ya acota el
-- recorrido a sus filas. Las tiendas WooCommerce marcaban varios por defecto,
-- así que el costo crecía solo con cada tienda conectada.
-- El flag `fields.is_indexed` queda (lo leen el API, el MCP y las plantillas
-- guardadas) pero ya no tiene efecto físico.
DO $$
DECLARE r record;
BEGIN
    FOR r IN SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'records' AND indexname LIKE 'imcrm\_ix\_%' LOOP
        EXECUTE format('DROP INDEX IF EXISTS %I', r.indexname);
    END LOOP;
END $$;
