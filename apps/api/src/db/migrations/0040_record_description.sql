-- v0.1.133 — Descripción rica del registro (editor de bloques estilo ClickUp).
--
-- Se guarda el ÁRBOL del documento (ProseMirror JSON), no HTML: lo que no
-- está en la whitelist de `sanitizeRichDoc` (packages/shared) simplemente no
-- se persiste, así el render nunca tiene que confiar en el contenido.
--
-- Columna aparte del JSONB de datos a propósito: `data` es el universo de los
-- campos de la lista (claves `f{id}`) y todo lo que entra ahí pasa por un
-- field definido; la descripción no es un campo, es del registro.
ALTER TABLE "records" ADD COLUMN IF NOT EXISTS "description" jsonb;
