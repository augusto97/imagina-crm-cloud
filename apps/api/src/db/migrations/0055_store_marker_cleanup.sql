-- v0.1.213 — Listas que quedaron marcadas como "de la tienda" después de
-- dejar de sincronizar o de borrar la conexión.
--
-- Hasta v0.1.212 la marca `lists.settings.store_sync` no se quitaba al
-- desconectar. Desde v0.1.213 la marca BLOQUEA (no se crean/borran registros
-- y las columnas de la tienda son de sólo lectura), así que una marca huérfana
-- dejaría la lista trabada para siempre. Las listas se conservan (ADR-S09):
-- sólo pierden la marca y vuelven a ser listas comunes de la empresa.
UPDATE lists l
SET settings = l.settings - 'store_sync'
WHERE l.settings ? 'store_sync'
  AND NOT EXISTS (
      SELECT 1 FROM connection_syncs cs
      WHERE cs.tenant_id = l.tenant_id
        AND cs.connection_id = (l.settings->'store_sync'->>'connection_id')::bigint
  );
