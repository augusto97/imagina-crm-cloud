-- v0.1.333 (ADR-S83) — Sincronizar un sitio WordPress.
--
-- Reusa `connection_syncs` (provider = 'wordpress') y `sync_links` de la
-- tienda (ADR-S24): una sincronización por conexión, y el vínculo «la entrada
-- 42 de ESTE sitio es el registro N» fuera de los datos de la fila (regla de
-- oro nº 1). El recurso de un sitio lleva el nombre del tipo de contenido o de
-- la taxonomía (`post:propiedad`, `term:product_cat`): WordPress admite nombres
-- de taxonomía de hasta 32 caracteres, así que el recurso pasa de 32 a 64.
-- Agrandar un varchar no reescribe la tabla ni sus índices.
ALTER TABLE "sync_links" ALTER COLUMN "resource" TYPE varchar(64);
