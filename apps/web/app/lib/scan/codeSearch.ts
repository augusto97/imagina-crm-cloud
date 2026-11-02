import { parseRecordLink, type CodeSearchResult } from '@imagina-base/shared';

import { api } from '@/lib/api';

/** H3 — Busca un código escaneado (en todas las listas o en una, por su campo «Código»). */
export async function searchCode(code: string, opts: { list?: number | string; field?: number } = {}): Promise<CodeSearchResult> {
    const query: Record<string, string> = { code };
    if (opts.list !== undefined) query.list = String(opts.list);
    if (opts.field !== undefined) query.field = String(opts.field);
    return (await api.get<CodeSearchResult>('/search/code', { query })).data;
}

/**
 * Un QR con el enlace a un registro de ESTA app (`…/lists/x/records/5`,
 * `…/lists/x/records?record=5` o las viejas con `#`) se abre directo, sin
 * buscar. v0.1.344 — venga del dominio que venga: las etiquetas impresas y
 * los correos llevan el dominio de la empresa (o el de la plataforma) y la
 * persona puede estar entrando por otro. Lo que decide es la ruta; abrirla
 * pasa por los permisos de siempre. `_origin` queda por compatibilidad.
 */
export function parseRecordLinkCode(code: string, _origin?: string): { listSlug: string; recordId: number } | null {
    return parseRecordLink(code);
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
