-- Visibilidad por dashboard (permisos finos):
--   workspace (default) = todo miembro interno; private = sólo el creador;
--   roles = sólo los roles listados en allowed_roles. El admin siempre ve todo.
ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS visibility varchar(16) NOT NULL DEFAULT 'workspace';
ALTER TABLE dashboards ADD COLUMN IF NOT EXISTS allowed_roles jsonb NOT NULL DEFAULT '[]';
