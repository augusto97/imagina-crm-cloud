import { jsonbKeyForField, type Field } from '@imagina-base/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { records } from '../db/schema';

/**
 * v0.1.294 — «Sin repetidos» para los caminos que escriben muchas filas de una
 * vez sin pasar por `RecordsService.create` (el import CSV hace un INSERT por
 * tandas). Carga UNA vez los valores ya guardados de cada campo `is_unique` y
 * va anotando los del lote: una fila repetida (contra la lista o contra otra
 * fila del mismo archivo) no entra y queda reportada. Misma normalización que
 * `RecordsService.assertUniqueInTx`: texto sin mayúsculas ni espacios en los
 * bordes, números por valor.
 */
export function uniqueKeyOf(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string') {
        const t = value.trim().toLowerCase();
        return t === '' ? null : t;
    }
    return null;
}

export class UniqueTracker {
    private constructor(
        private readonly fields: Field[],
        private readonly seen: Map<number, Set<string>>,
    ) {}

    static async load(tx: Tx, tenantId: number, listId: number, fields: Field[]): Promise<UniqueTracker> {
        const unique = fields.filter((f) => f.is_unique);
        const seen = new Map<number, Set<string>>();
        for (const f of unique) {
            const key = jsonbKeyForField(f.id);
            const rows = await tx
                .select({ v: sql<string | null>`${records.data}->>${key}` })
                .from(records)
                .where(and(eq(records.tenantId, tenantId), eq(records.listId, listId), isNull(records.deletedAt), sql`${records.data} ? ${key}`));
            const set = new Set<string>();
            for (const r of rows) {
                const k = uniqueKeyOf(r.v);
                if (k !== null) set.add(k);
            }
            seen.set(f.id, set);
        }
        return new UniqueTracker(unique, seen);
    }

    /**
     * ¿La fila choca con un valor ya guardado (o con otra fila del lote)? Si no
     * choca, sus valores quedan reservados. Devuelve el motivo, o null.
     */
    claim(data: Record<string, unknown>): string | null {
        const pending: Array<[Set<string>, string]> = [];
        for (const f of this.fields) {
            const raw = data[jsonbKeyForField(f.id)];
            const k = uniqueKeyOf(raw);
            if (k === null) continue;
            const set = this.seen.get(f.id)!;
            if (set.has(k) || pending.some(([s, v]) => s === set && v === k)) {
                return `«${String(raw).trim()}» ya está en otro registro: «${f.label}» no admite valores repetidos.`;
            }
            pending.push([set, k]);
        }
        for (const [set, k] of pending) set.add(k);
        return null;
    }

    get active(): boolean {
        return this.fields.length > 0;
    }
}
