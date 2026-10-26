import type { CodeSearchResult } from '@imagina-base/shared';

import { api } from '@/lib/api';

/** H3 — Busca un código escaneado (en todas las listas o en una, por su campo «Código»). */
export async function searchCode(code: string, opts: { list?: number | string; field?: number } = {}): Promise<CodeSearchResult> {
    const query: Record<string, string> = { code };
    if (opts.list !== undefined) query.list = String(opts.list);
    if (opts.field !== undefined) query.field = String(opts.field);
    return (await api.get<CodeSearchResult>('/search/code', { query })).data;
}

/**
 * Un QR con el enlace a un registro de ESTA app (`…/#/lists/x/records/5` o
 * `…/#/lists/x/records?record=5`) se abre directo, sin buscar. Sólo del mismo
 * origen: un QR con otro dominio se busca como texto.
 */
export function parseRecordLinkCode(code: string, origin: string): { listSlug: string; recordId: number } | null {
    let url: URL;
    try {
        url = new URL(code.trim());
    } catch {
        return null;
    }
    if (url.origin !== origin) return null;
    const route = url.hash.startsWith('#') ? url.hash.slice(1) : url.pathname + url.search;
    const direct = /^\/lists\/([a-z0-9_-]+)\/records\/(\d+)(?:[/?#]|$)/i.exec(route);
    if (direct) return { listSlug: direct[1]!, recordId: Number(direct[2]) };
    const query = /^\/lists\/([a-z0-9_-]+)\/records\?(?:.*&)?record=(\d+)/i.exec(route);
    if (query) return { listSlug: query[1]!, recordId: Number(query[2]) };
    return null;
}

/** El código para llenar un campo: texto tal cual; número sólo si lo es. */
export function codeForField(code: string, type: string): { ok: true; value: string | number } | { ok: false; message: string } {
    if (type === 'number') {
        const n = /^-?\d+(\.\d+)?$/.test(code.trim()) ? Number(code.trim()) : NaN;
        if (!Number.isFinite(n) || !Number.isSafeInteger(Math.trunc(n))) {
            return { ok: false, message: 'El código leído no es un número: este campo sólo acepta números.' };
        }
        return { ok: true, value: n };
    }
    return { ok: true, value: code };
}
