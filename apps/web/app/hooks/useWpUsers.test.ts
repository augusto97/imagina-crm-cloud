import { afterEach, describe, expect, it, vi } from 'vitest';

import { loadWpUser } from './useWpUsers';

/**
 * Las celdas de persona piden de a UNA (`useWpUser(id)`): el cargador junta
 * todas las del mismo tick en un solo `GET /me/users?ids=` (regla de oro nº 8).
 */
describe('loadWpUser — una request para todas las personas del tick', () => {
    afterEach(() => vi.unstubAllGlobals());

    const stub = (handler: (url: string) => unknown): string[] => {
        const urls: string[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string) => {
            urls.push(String(url));
            const body = handler(String(url));
            if (body === null) return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
            return new Response(JSON.stringify({ data: body }), { status: 200, headers: { 'content-type': 'application/json' } });
        }));
        return urls;
    };
    const user = (id: number) => ({ id, login: `u${id}`, display_name: `Persona ${id}`, avatar_url: '' });

    it('40 personas distintas (y repetidas) → UNA request con todos los ids', async () => {
        const urls = stub(() => Array.from({ length: 40 }, (_, i) => user(i + 1)));
        const ids = [...Array.from({ length: 40 }, (_, i) => i + 1), 3, 3, 7];
        const got = await Promise.all(ids.map((id) => loadWpUser(id)));
        expect(urls).toHaveLength(1);
        expect(urls[0]).toContain('/me/users?ids=');
        expect(decodeURIComponent(urls[0]!)).toContain('ids=1,2,3,4,');
        expect(urls[0]).not.toMatch(/\/me\/users\/\d/);
        expect(got[0]?.display_name).toBe('Persona 1');
        expect(got[41]?.display_name).toBe('Persona 3');
    });

    it('quien no vuelve en la respuesta es null; un id inválido no pide nada', async () => {
        const urls = stub(() => [user(5)]);
        const [a, b, c] = await Promise.all([loadWpUser(5), loadWpUser(6), loadWpUser(0)]);
        expect(a?.id).toBe(5);
        expect(b).toBeNull();
        expect(c).toBeNull();
        expect(urls).toHaveLength(1);
    });

    it('si la carga falla, todos reciben null (la celda muestra «Usuario #N»)', async () => {
        stub(() => null);
        expect(await Promise.all([loadWpUser(8), loadWpUser(9)])).toEqual([null, null]);
    });

    it('más de 100 personas se reparten en tandas de 100', async () => {
        const urls = stub((url) => {
            const ids = decodeURIComponent(url).split('ids=')[1]!.split(',').map(Number);
            return ids.map(user);
        });
        const got = await Promise.all(Array.from({ length: 150 }, (_, i) => loadWpUser(i + 1)));
        expect(urls).toHaveLength(2);
        expect(got.every((u) => u !== null)).toBe(true);
    });
});
