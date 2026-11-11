import { describe, expect, it } from 'vitest';
import {
    MCP_MAX_CALLS_PER_POST,
    MCP_TENANT_CALLS_PER_MINUTE,
    MCP_TOKEN_CALLS_PER_MINUTE,
    checkMcpBudget,
    countToolCalls,
    jsonRpcId,
} from '../src/ai/mcp-budget';

/** Redis en memoria (sin Lua): lo justo para `incrWithTtl`. */
function fakeRedis() {
    const data = new Map<string, number>();
    return {
        data,
        incr: async (key: string) => {
            const n = (data.get(key) ?? 0) + 1;
            data.set(key, n);
            return n;
        },
        expire: async () => 1,
    };
}

const call = (id: number) => ({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'list_lists', arguments: {} } });
const NOW = 1_800_000_000_000;

describe('presupuesto del endpoint MCP', () => {
    it('cuenta las llamadas a herramientas de un mensaje o de un lote', () => {
        expect(countToolCalls(call(1))).toBe(1);
        expect(countToolCalls([call(1), { jsonrpc: '2.0', id: 2, method: 'tools/list' }, call(3)])).toBe(2);
        expect(countToolCalls({ jsonrpc: '2.0', id: 1, method: 'initialize' })).toBe(0);
        expect(countToolCalls(null)).toBe(0);
        expect(jsonRpcId(call(7))).toBe(7);
        expect(jsonRpcId([call(7)])).toBeNull();
    });

    it('rechaza un lote con más llamadas que el máximo, sin gastar presupuesto', async () => {
        const redis = fakeRedis();
        const batch = Array.from({ length: MCP_MAX_CALLS_PER_POST + 1 }, (_, i) => call(i));
        const res = await checkMcpBudget(redis, { tokenId: 1, tenantId: 1 }, batch, NOW);
        expect(res).toMatchObject({ ok: false, code: -32600 });
        expect(redis.data.size).toBe(0);
        expect((await checkMcpBudget(redis, { tokenId: 1, tenantId: 1 }, batch.slice(1), NOW)).ok).toBe(true);
    });

    it('corta al pasar el máximo por minuto del token y vuelve en el minuto siguiente', async () => {
        const redis = fakeRedis();
        const who = { tokenId: 5, tenantId: 9 };
        const batch = Array.from({ length: 20 }, (_, i) => call(i));
        for (let i = 0; i < MCP_TOKEN_CALLS_PER_MINUTE / 20; i += 1) {
            expect((await checkMcpBudget(redis, who, batch, NOW)).ok).toBe(true);
        }
        const blocked = await checkMcpBudget(redis, who, call(1), NOW);
        expect(blocked).toMatchObject({ ok: false, code: -32029 });
        expect(blocked.retryAfter).toBeGreaterThan(0);
        // Otro token de la misma empresa sigue pudiendo; el mismo, al minuto siguiente.
        expect((await checkMcpBudget(redis, { tokenId: 6, tenantId: 9 }, call(1), NOW)).ok).toBe(true);
        expect((await checkMcpBudget(redis, who, call(1), NOW + 60_000)).ok).toBe(true);
    });

    it('la empresa entera también tiene tope (muchos tokens)', async () => {
        const redis = fakeRedis();
        const batch = Array.from({ length: 20 }, (_, i) => call(i));
        let token = 100;
        for (let used = 0; used < MCP_TENANT_CALLS_PER_MINUTE; used += 20) {
            token += 1;
            expect((await checkMcpBudget(redis, { tokenId: token, tenantId: 3 }, batch, NOW)).ok).toBe(true);
        }
        expect(await checkMcpBudget(redis, { tokenId: 999, tenantId: 3 }, call(1), NOW)).toMatchObject({ ok: false, code: -32029 });
        expect((await checkMcpBudget(redis, { tokenId: 999, tenantId: 4 }, call(1), NOW)).ok).toBe(true);
    });

    it('un pedido sin herramientas (initialize, tools/list) cuenta como uno; sin Redis no se bloquea', async () => {
        const redis = fakeRedis();
        await checkMcpBudget(redis, { tokenId: 1, tenantId: 1 }, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, NOW);
        expect([...redis.data.values()]).toEqual([1, 1]);
        const broken = { incr: async () => Promise.reject(new Error('down')), expire: async () => 1 };
        expect((await checkMcpBudget(broken, { tokenId: 1, tenantId: 1 }, call(1), NOW)).ok).toBe(true);
    });
});
