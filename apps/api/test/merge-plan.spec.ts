import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BLOCKING, LEFT_BEHIND, MOVE_STEPS, SPECIAL_MOVES } from '../src/duplicates/merge-plan';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * A14 (v0.1.445) — Fusionar sólo es seguro si sabe qué hacer con CADA tabla
 * que apunta a un registro. Si una versión futura suma una tabla con un
 * `record_id` y no la clasifica en `merge-plan.ts`, esta prueba falla: así la
 * fila no queda colgando del registro que se va a la papelera sin que nadie
 * lo decida.
 */
describe('fusionar: cada referencia a un registro está clasificada (v0.1.445)', () => {
    let pg: TestPg;

    beforeAll(async () => {
        pg = await startPostgres();
    });

    afterAll(async () => {
        await pg?.stop();
    });

    const classified = (): Set<string> => {
        const out = new Set<string>();
        for (const s of MOVE_STEPS) out.add(`${s.table}.${s.column}`);
        for (const s of SPECIAL_MOVES) for (const c of s.columns) out.add(`${s.table}.${c}`);
        for (const [t, c] of LEFT_BEHIND) out.add(`${t}.${c}`);
        for (const b of BLOCKING) out.add(`${b.table}.${b.column}`);
        return out;
    };

    it('toda clave foránea hacia records está movida, especial, se queda o bloquea', async () => {
        const res = await pg.db.execute(sql`
            SELECT cl.relname AS tbl, a.attname AS col
            FROM pg_constraint c
            JOIN pg_class cl ON cl.oid = c.conrelid
            JOIN pg_namespace n ON n.oid = cl.relnamespace AND n.nspname = 'public'
            JOIN LATERAL unnest(c.conkey) AS k(attnum) ON TRUE
            JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
            WHERE c.contype = 'f' AND c.confrelid = 'public.records'::regclass`);
        const fks = (res.rows as Array<{ tbl: string; col: string }>).map((r) => `${r.tbl}.${r.col}`);
        expect(fks.length).toBeGreaterThan(10);
        const known = classified();
        const missing = fks.filter((k) => !known.has(k));
        expect(missing, `Clasifica en apps/api/src/duplicates/merge-plan.ts: ${missing.join(', ')}`).toEqual([]);
    });

    it('las columnas que se llaman *record_id* (aunque no tengan clave foránea) también', async () => {
        const res = await pg.db.execute(sql`
            SELECT table_name AS tbl, column_name AS col
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND (column_name = 'record_id' OR column_name LIKE '%\_record\_id' ESCAPE '\\')`);
        const cols = (res.rows as Array<{ tbl: string; col: string }>).map((r) => `${r.tbl}.${r.col}`);
        const known = classified();
        // Referencias que no son a un registro de una lista (o que viven en otra tabla del mismo dueño).
        const notRecords = new Set<string>([]);
        const missing = cols.filter((k) => !known.has(k) && !notRecords.has(k));
        expect(missing, `Clasifica en apps/api/src/duplicates/merge-plan.ts: ${missing.join(', ')}`).toEqual([]);
    });

    it('si un paso movido choca con un índice único, tiene su regla de conflicto', async () => {
        let checked = 0;
        for (const step of MOVE_STEPS) {
            const res = await pg.db.execute(sql`
                SELECT i.relname AS idx, array_agg(a.attname ORDER BY a.attname) AS cols
                FROM pg_index x
                JOIN pg_class t ON t.oid = x.indrelid AND t.relname = ${step.table}
                JOIN pg_namespace n ON n.oid = t.relnamespace AND n.nspname = 'public'
                JOIN pg_class i ON i.oid = x.indexrelid
                JOIN LATERAL unnest(x.indkey) AS k(attnum) ON TRUE
                JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
                WHERE x.indisunique AND NOT x.indisprimary
                GROUP BY i.relname`);
            const uniques = (res.rows as Array<{ idx: string; cols: string[] }>).filter((u) => u.cols.includes(step.column));
            if (uniques.length === 0) continue;
            checked++;
            // Un único que sólo es (tenant_id, columna) no deja mover dos filas al
            // mismo registro: también necesita su regla.
            expect(step.conflict, `${step.table}.${step.column} tiene ${uniques.map((u) => u.idx).join(', ')} y no tiene regla de conflicto`).toBeTypeOf('function');
        }
        // relations (×2), recurrences, portal_links, record_shares, helpdesk_tickets, document_numbers…
        expect(checked).toBeGreaterThanOrEqual(5);
    });
});
