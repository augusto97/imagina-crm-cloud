// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { clearMostUsedQueue, flushMostUsed, localDay, noteMostUsedVisit, resetShown, setMostUsedFlushListener, stableShown } from './mostUsed';

const T0 = new Date(2026, 10, 6, 10, 0, 0).getTime();
const queue = (tenantId: number): unknown[] => JSON.parse(window.localStorage.getItem(`imcrm:most-used-queue:${tenantId}`) ?? '[]');

describe('«Más usadas» en el navegador (v0.1.385)', () => {
    beforeEach(() => {
        window.localStorage.clear();
        clearMostUsedQueue(1);
        clearMostUsedQueue(2);
        resetShown(1);
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        setMostUsedFlushListener(null);
    });

    it('anota en la cola del dispositivo, una vez cada 30 minutos por lista, y por empresa', () => {
        noteMostUsedVisit(1, { kind: 'list', id: 7 }, T0);
        noteMostUsedVisit(1, { kind: 'list', id: 7 }, T0 + 5 * 60_000);
        noteMostUsedVisit(1, { kind: 'dashboard', id: 3 }, T0 + 6 * 60_000);
        noteMostUsedVisit(2, { kind: 'list', id: 7 }, T0 + 7 * 60_000);
        expect(queue(1)).toEqual([
            { kind: 'list', id: 7, at: T0, day: localDay(new Date(T0)) },
            { kind: 'dashboard', id: 3, at: T0 + 6 * 60_000, day: localDay(new Date(T0)) },
        ]);
        expect(queue(2)).toHaveLength(1);
        noteMostUsedVisit(1, { kind: 'list', id: 7 }, T0 + 31 * 60_000);
        expect(queue(1)).toHaveLength(3);
        noteMostUsedVisit(null, { kind: 'list', id: 7 }, T0);
    });

    it('manda la cola junta, con SU empresa, y vacía lo enviado', async () => {
        const state = { enabled: true, items: [{ kind: 'list', id: 7 }] };
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(state), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const seen: unknown[] = [];
        setMostUsedFlushListener((tid, s) => seen.push([tid, s]));

        noteMostUsedVisit(2, { kind: 'list', id: 7 }, T0);
        noteMostUsedVisit(2, { kind: 'list', id: 8 }, T0 + 1000);
        await flushMostUsed(2);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0]!;
        expect(url).toBe('/api/v1/me/most-used/visits');
        expect((init as RequestInit).headers).toMatchObject({ 'X-Tenant-Id': '2' });
        expect(JSON.parse((init as RequestInit).body as string).visits).toHaveLength(2);
        expect(queue(2)).toEqual([]);
        expect(seen).toEqual([[2, state]]);
    });

    it('sin red o con el servidor caído, la cola queda para la próxima', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
        noteMostUsedVisit(1, { kind: 'list', id: 7 }, T0);
        await flushMostUsed(1);
        expect(queue(1)).toHaveLength(1);
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })));
        await flushMostUsed(1);
        expect(queue(1)).toHaveLength(1);
    });

    it('el orden mostrado se fija por día y empresa', () => {
        expect(stableShown(1, ['l:1', 'l:2', 'd:3'], '2026-11-06')).toEqual(['l:1', 'l:2', 'd:3']);
        expect(stableShown(1, ['d:3', 'l:2', 'l:1'], '2026-11-06')).toEqual(['l:1', 'l:2', 'd:3']);
        // Al día siguiente se reordena.
        expect(stableShown(1, ['d:3', 'l:2', 'l:1'], '2026-11-07')).toEqual(['d:3', 'l:2', 'l:1']);
        resetShown(1);
        expect(stableShown(1, ['l:2', 'l:1'], '2026-11-06')).toEqual(['l:2', 'l:1']);
    });
});
