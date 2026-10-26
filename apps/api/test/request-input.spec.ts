import { allSafeIds, listRecordsQuerySchema, queryIdSchema } from '@imagina-base/shared';
import { sql } from 'drizzle-orm';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ApiExceptionFilter, pgErrorCode, pgErrorResponse } from '../src/common/http-exception.filter';
import { cleanString, exceedsArrayItems, hasImpossibleId, MAX_BODY_ARRAY_ITEMS, registerRequestInputHooks, sanitizeInput } from '../src/common/request-input';
import { createDb, createPool, withoutTimeouts } from '../src/db/client';
import { tenants } from '../src/db/schema';
import { startPostgres, type TestPg } from './helpers/containers';

describe('higiene de la entrada (NUL, sustitutos sueltos, ids imposibles)', () => {
    it('cleanString quita NUL, reemplaza mitades sueltas y conserva pares válidos', () => {
        expect(cleanString('a\u0000b')).toBe('ab');
        expect(cleanString('x\uD800y')).toBe('x�y');
        expect(cleanString('x\uDC00y')).toBe('x�y');
        expect(cleanString('emoji 😀 ok')).toBe('emoji 😀 ok');
        expect(cleanString('sin nada raro')).toBe('sin nada raro');
    });

    it('sanitizeInput limpia valores y claves en el lugar, anidado y sin recursión', () => {
        const body: Record<string, unknown> = { 'f1\u0000': 'v\u0000', list: ['a\uD800', { deep: 'z\u0000' }], n: 3, b: true, nil: null };
        sanitizeInput(body);
        expect(body).toEqual({ f1: 'v', list: ['a�', { deep: 'z' }], n: 3, b: true, nil: null });
        // Muy anidado: no revienta la pila.
        let deep: unknown = 'fin\u0000';
        for (let i = 0; i < 50_000; i++) deep = [deep];
        expect(() => sanitizeInput(deep)).not.toThrow();
        // Lo que no es JSON se deja tal cual.
        const buf = Buffer.from([0, 1, 2]);
        expect(sanitizeInput(buf)).toBe(buf);
        expect(sanitizeInput('q\u0000')).toBe('q');
    });

    it('detecta ids de ruta imposibles (sólo dígitos y más allá del entero seguro)', () => {
        expect(hasImpossibleId({ list: '99999999999999999999999' })).toBe(true);
        expect(hasImpossibleId({ list: 'clientes', id: '9223372036854775808' })).toBe(true);
        expect(hasImpossibleId({ id: '9007199254740991' })).toBe(false);
        expect(hasImpossibleId({ list: 'clientes2026' })).toBe(false);
    });

    it('los ids de la query string tienen el mismo tope (400, no 500)', () => {
        expect(queryIdSchema.safeParse('9223372036854775808').success).toBe(false);
        expect(queryIdSchema.safeParse('42').success).toBe(true);
        expect(listRecordsQuerySchema.safeParse({ cursor: '9223372036854775808' }).success).toBe(false);
        expect(listRecordsQuerySchema.safeParse({ parent: '99999999999999999999' }).success).toBe(false);
        expect(listRecordsQuerySchema.safeParse({ ids: '1,99999999999999999999' }).success).toBe(false);
        expect(listRecordsQuerySchema.safeParse({ related_to: '3:99999999999999999999' }).success).toBe(false);
        expect(listRecordsQuerySchema.safeParse({ ids: '1,2,3', related_to: '3:4' }).success).toBe(true);
        expect(allSafeIds('1,2')).toBe(true);
    });

    it('el hook de Fastify limpia cuerpo, query y params, y corta ids imposibles con 404', async () => {
        const app = Fastify();
        registerRequestInputHooks(app);
        app.post('/echo/:id', async (req) => ({ params: req.params, query: req.query, body: req.body }));
        app.get('/echo/:id', async (req) => ({ params: req.params, query: req.query }));
        await app.ready();

        const post = await app.inject({
            method: 'POST',
            url: '/echo/12?search=%00hola',
            headers: { 'content-type': 'application/json' },
            payload: '{"nombre":"Ana\\u0000","nota":"x\\ud800y","tags":["\\u0000a"]}',
        });
        expect(post.statusCode).toBe(200);
        expect(post.json()).toEqual({
            params: { id: '12' },
            query: { search: 'hola' },
            body: { nombre: 'Ana', nota: 'x�y', tags: ['a'] },
        });

        const huge = await app.inject({ method: 'GET', url: '/echo/99999999999999999999999' });
        expect(huge.statusCode).toBe(404);
        expect(huge.json()).toMatchObject({ code: 'not_found' });
        const max = await app.inject({ method: 'GET', url: '/echo/9007199254740991' });
        expect(max.statusCode).toBe(200);
        await app.close();
    });

    it('corta los cuerpos con demasiados elementos de array antes de validar (GHSA-mrhx-c7xc-m3w5)', async () => {
        expect(exceedsArrayItems({ rows: Array(10_000).fill({ a: 'x' }), tags: ['a', 'b'] })).toBe(false);
        expect(exceedsArrayItems(Array(MAX_BODY_ARRAY_ITEMS).fill(0))).toBe(false);
        expect(exceedsArrayItems(Array(MAX_BODY_ARRAY_ITEMS + 1).fill(0))).toBe(true);
        // Se suman todos los arrays, a cualquier profundidad.
        expect(exceedsArrayItems({ a: [Array(60_000).fill(0)], b: { c: Array(60_000).fill(0) } })).toBe(true);
        expect(exceedsArrayItems('texto')).toBe(false);
        expect(exceedsArrayItems(Buffer.alloc(10))).toBe(false);

        const app = Fastify({ bodyLimit: 4 * 1024 * 1024 });
        registerRequestInputHooks(app);
        let reached = false;
        app.post('/echo', async (req) => {
            reached = true;
            return { n: Array.isArray(req.body) ? req.body.length : 0 };
        });
        await app.ready();
        const big = await app.inject({
            method: 'POST',
            url: '/echo',
            headers: { 'content-type': 'application/json' },
            payload: JSON.stringify(Array(1_000_000).fill(0)),
        });
        expect(big.statusCode).toBe(413);
        expect(big.json()).toMatchObject({ code: 'too_many_items', data: { status: 413 } });
        expect(reached).toBe(false);
        const ok = await app.inject({
            method: 'POST',
            url: '/echo',
            headers: { 'content-type': 'application/json' },
            payload: JSON.stringify(Array(10_000).fill(0)),
        });
        expect(ok.statusCode).toBe(200);
        expect(ok.json()).toEqual({ n: 10_000 });
        await app.close();
    });
});

describe('errores de Postgres → respuestas que no son 500 (Postgres real)', () => {
    let pg: TestPg;

    beforeAll(async () => {
        pg = await startPostgres();
    });
    afterAll(async () => {
        await pg?.stop();
    });

    /** El error tal como lo lanza drizzle (envuelto en DrizzleQueryError). */
    async function failing(q: Promise<unknown>): Promise<unknown> {
        try {
            await q;
        } catch (err) {
            return err;
        }
        throw new Error('la consulta no falló');
    }

    function hostFor(): { host: never; sent: { status?: number; body?: unknown } } {
        const sent: { status?: number; body?: unknown } = {};
        const reply = { status: (code: number) => { sent.status = code; return { send: (b: unknown) => { sent.body = b; } }; } };
        const host = { switchToHttp: () => ({ getResponse: () => reply, getRequest: () => ({ method: 'POST', url: '/x?y=1' }) }) };
        return { host: host as never, sent };
    }

    it('NUL en texto (22021), NUL en jsonb (22P05), sustituto suelto en jsonb y bigint fuera de rango → 400', async () => {
        const errs = [
            await failing(pg.db.execute(sql`select ${'a\u0000b'}::text`)),
            await failing(pg.db.execute(sql`select ${JSON.stringify({ a: 'x\u0000' })}::jsonb`)),
            await failing(pg.db.execute(sql`select ${JSON.stringify({ a: 'x\uD800' })}::jsonb`)),
            await failing(pg.db.execute(sql`select ${'9223372036854775808'}::bigint`)),
            await failing(pg.db.execute(sql`select ${'1e+23'}::bigint`)),
        ];
        for (const err of errs) {
            expect(pgErrorCode(err)).not.toBeNull();
            expect(pgErrorResponse(err)).toMatchObject({ status: 400, code: 'invalid_input' });
            const { host, sent } = hostFor();
            new ApiExceptionFilter().catch(err, host);
            expect(sent.status).toBe(400);
        }
    });

    it('violación de unicidad (doble envío) → 409', async () => {
        await pg.db.insert(tenants).values({ slug: 'dup', name: 'Dup' });
        const err = await failing(pg.db.insert(tenants).values({ slug: 'dup', name: 'Dup 2' }));
        expect(pgErrorCode(err)).toBe('23505');
        const { host, sent } = hostFor();
        new ApiExceptionFilter().catch(err, host);
        expect(sent.status).toBe(409);
        expect(sent.body).toMatchObject({ code: 'conflict' });
    });

    it('el pool corta las sentencias largas (503) y withoutTimeouts lo levanta dentro de la transacción', async () => {
        const pool = createPool(pg.container.getConnectionUri(), { statementTimeoutMs: 200, idleInTransactionMs: 1000 });
        const db = createDb(pool);
        try {
            const err = await failing(db.execute(sql`select pg_sleep(1)`));
            expect(pgErrorCode(err)).toBe('57014');
            const { host, sent } = hostFor();
            new ApiExceptionFilter().catch(err, host);
            expect(sent.status).toBe(503);
            await db.transaction(async (tx) => {
                await withoutTimeouts(tx);
                await tx.execute(sql`select pg_sleep(0.4)`);
            });
            // Una transacción que queda abierta sin hacer nada se corta sola.
            const idle = await failing(
                db.transaction(async (tx) => {
                    await tx.execute(sql`select 1`);
                    await new Promise((r) => setTimeout(r, 1500));
                    await tx.execute(sql`select 1`);
                }),
            );
            expect(idle).toBeInstanceOf(Error);
        } finally {
            await pool.end();
        }
    });
});
