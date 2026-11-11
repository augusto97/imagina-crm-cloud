import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startPostgres, type TestPg } from './helpers/containers';

/**
 * Las cascadas de una FK no pasan por la RLS: buscan por la columna sola. Sin
 * un índice que EMPIECE por ella, borrar el padre recorre la tabla hija entera
 * (la de todas las empresas). Este spec fija las que ya dieron problemas.
 */
describe('índices de las FKs que cascadean (migración 0119)', () => {
    let pg: TestPg;
    beforeAll(async () => {
        pg = await startPostgres();
    });
    afterAll(async () => {
        await pg?.stop();
    });

    const leading = async (table: string, column: string): Promise<boolean> => {
        const res = await pg.db.execute(sql`
            select 1 from pg_index i
            join pg_attribute a on a.attrelid = i.indrelid and a.attnum = i.indkey[0]
            where i.indrelid = ${table}::regclass and a.attname = ${column} limit 1`);
        return res.rows.length > 0;
    };

    it('mentions.comment_id y los list_id que cascadean tienen un índice que empieza por esa columna', async () => {
        expect(await leading('mentions', 'comment_id')).toBe(true);
        for (const t of ['comments', 'mentions', 'recurrences', 'payment_links', 'portal_links', 'list_slug_history']) {
            expect(await leading(t, 'list_id'), t).toBe(true);
        }
    });

    it('el índice de trigramas de la descripción (que ya nada usaba) no está', async () => {
        const res = await pg.db.execute(sql`select 1 from pg_indexes where indexname = 'records_description_text_trgm_idx'`);
        expect(res.rows).toHaveLength(0);
    });
});
