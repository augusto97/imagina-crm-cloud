/** Fila aplanada de un JSON recibido: ruta con puntos + vista previa del valor. */
export interface FlatEntry {
    path: string;
    value: string;
}

/**
 * Aplana un JSON a rutas con puntos (`contacto.email`, `items.0.sku`), como
 * las variables `{{payload.x}}`. Tope de 40 filas.
 */
export function flattenPayload(value: unknown, prefix: string, out: FlatEntry[]): void {
    if (out.length >= 40) return;
    if (value !== null && typeof value === 'object') {
        const entries = Array.isArray(value)
            ? value.map((v, i) => [String(i), v] as const)
            : Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) {
            out.push({ path: prefix, value: Array.isArray(value) ? '[]' : '{}' });
            return;
        }
        for (const [k, v] of entries) {
            flattenPayload(v, prefix === '' ? k : `${prefix}.${k}`, out);
        }
        return;
    }
    const s = value === null ? 'null' : String(value);
    out.push({ path: prefix, value: s.length > 60 ? `${s.slice(0, 60)}…` : s });
}

/** Las rutas de un JSON recibido que sirven como dato en una condición (sin las vacías). */
export function payloadPaths(payload: unknown): string[] {
    const rows: FlatEntry[] = [];
    flattenPayload(payload, '', rows);
    return rows.map((r) => r.path).filter((p) => p !== '' && /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/.test(p));
}
