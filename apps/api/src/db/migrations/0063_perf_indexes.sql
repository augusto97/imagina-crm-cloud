-- v0.1.252 — auditoría de rendimiento. Todos los índices se crean SIN
-- CONCURRENTLY porque el migrador corre cada archivo en una transacción; con el
-- volumen actual de las instalaciones el lock de escritura dura segundos.

-- (1) Índices por la columna de cada FK que apunta a `records`. Sin ellos, borrar
-- registros (o una lista entera, que cascadea) recorría estas tablas COMPLETAS —
-- de todas las empresas— por cada fila: medido ~3 ms por registro en `relations`.
-- Los compuestos que empezaban por tenant_id se reordenan para servir a las dos
-- cosas (las consultas también filtran por tenant_id, que va segundo).
DROP INDEX IF EXISTS "relations_source_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relations_source_idx" ON "relations" ("source_record_id", "tenant_id");--> statement-breakpoint
DROP INDEX IF EXISTS "relations_target_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "relations_target_idx" ON "relations" ("target_record_id", "tenant_id");--> statement-breakpoint
DROP INDEX IF EXISTS "recurrences_tenant_record_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "recurrences_tenant_record_idx" ON "recurrences" ("record_id", "tenant_id");--> statement-breakpoint
DROP INDEX IF EXISTS "payment_links_record_ix";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "payment_links_record_ix" ON "payment_links" ("record_id", "tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comments_record_fk_ix" ON "comments" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mentions_record_fk_ix" ON "mentions" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "portal_links_record_fk_ix" ON "portal_links" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "bulk_edit_items_record_fk_ix" ON "bulk_edit_items" ("record_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "records_parent_fk_ix" ON "records" ("parent_id") WHERE "parent_id" IS NOT NULL;--> statement-breakpoint

-- (2) Listado por defecto (ORDER BY id) de una lista: el planner recorría la PK de
-- la tabla COMPARTIDA descartando las filas de las demás listas (crece con el
-- total de registros de la instalación, no con los de la lista). Medido: 8,8 ms
-- → 0,07 ms. El predicado tiene que incluir parent_id IS NULL: es el que usa el
-- listado de primer nivel; sin él el planner no lo elige.
CREATE INDEX IF NOT EXISTS "records_list_id_ix" ON "records" ("tenant_id", "list_id", "id") WHERE "deleted_at" IS NULL AND "parent_id" IS NULL;--> statement-breakpoint

-- (3) Actividad por lista ordenada por id DESC: mismo problema.
DROP INDEX IF EXISTS "activity_list_idx";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "activity_list_idx" ON "activity" ("tenant_id", "list_id", "id" DESC);--> statement-breakpoint

-- (4) `due_date_reached` pregunta por cada registro si ya hubo una corrida.
CREATE INDEX IF NOT EXISTS "automation_runs_record_ix" ON "automation_runs" ("tenant_id", "automation_id", "record_id");--> statement-breakpoint

-- (5) El barrido de links de pago vencidos (cada 15 min) sólo mira pendientes.
CREATE INDEX IF NOT EXISTS "payment_links_pending_exp_ix" ON "payment_links" ("expires_at") WHERE "status" = 'pending';--> statement-breakpoint

-- (6) Dos GIN globales sobre `records.data` que ninguna consulta usa (idx_scan = 0
-- medido): el FTS nunca se consultó y el jsonb_path_ops no aplica a las
-- comparaciones `data -> 'fN'` del query builder. Encarecían cada escritura
-- (UPDATE de 2.000 filas: 163 ms con ellos, 70 ms sin ellos).
DROP INDEX IF EXISTS "idx_records_fts";--> statement-breakpoint
DROP INDEX IF EXISTS "idx_records_data";--> statement-breakpoint

-- (7) Los índices de expresión de los campos `is_indexed` pasan a cubrir SÓLO
-- su lista (antes indexaban la tabla compartida entera). Se recrean con el
-- mismo nombre y la misma expresión que arma `record-indexes.ts`.
DO $$
DECLARE
    f record;
    expr text;
    pred text;
BEGIN
    FOR f IN SELECT id, list_id, type FROM fields WHERE is_indexed LOOP
        pred := format('WHERE deleted_at IS NULL AND list_id = %s', f.list_id);
        expr := format('(data ->> %L)', 'f' || f.id);
        IF f.type IN ('number', 'currency', 'rating', 'percent', 'duration') THEN
            expr := format('((data ->> %L)::numeric)', 'f' || f.id);
        ELSIF f.type = 'date' THEN
            expr := format('((data ->> %L)::date)', 'f' || f.id);
        ELSIF f.type = 'datetime' THEN
            expr := format('((data ->> %L)::timestamptz)', 'f' || f.id);
        ELSIF f.type NOT IN ('text', 'long_text', 'email', 'url', 'phone', 'select', 'checkbox', 'user', 'file') THEN
            CONTINUE;
        END IF;
        EXECUTE format('DROP INDEX IF EXISTS imcrm_ix_f%s', f.id);
        EXECUTE format('CREATE INDEX imcrm_ix_f%s ON records (%s) %s', f.id, expr, pred);
        IF f.type IN ('text', 'long_text', 'email', 'url', 'phone') THEN
            EXECUTE format('DROP INDEX IF EXISTS imcrm_ix_f%s_trgm', f.id);
            EXECUTE format('CREATE INDEX imcrm_ix_f%s_trgm ON records USING gin ((data ->> %L) gin_trgm_ops) %s', f.id, 'f' || f.id, pred);
        END IF;
    END LOOP;
END $$;
