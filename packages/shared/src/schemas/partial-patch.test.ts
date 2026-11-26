import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as shared from '../index';
import { partialPatch } from './common';

const DEFAULTS = new Set(['default', 'prefault']);
type Def = { type?: string; innerType?: unknown; shape?: Record<string, unknown>; element?: unknown; options?: unknown[]; in?: unknown; out?: unknown };
const defOf = (s: unknown): Def | undefined => (s as { _zod?: { def?: Def } })?._zod?.def;

/**
 * Recorre un esquema y devuelve las rutas de los campos `optional(default)` /
 * `optional(prefault)`: en Zod 4 se rellenan aunque no lleguen, y un PATCH que
 * se mezcla sobre lo guardado devuelve esos ajustes a su valor de fábrica.
 */
function optionalDefaults(schema: unknown, path: string, seen: Set<unknown>, out: string[]): void {
    if (!schema || seen.has(schema)) return;
    seen.add(schema);
    const def = defOf(schema);
    if (!def) return;
    switch (def.type) {
        case 'object':
            for (const [key, field] of Object.entries(def.shape ?? {})) {
                const fdef = defOf(field);
                if (fdef?.type === 'optional' && DEFAULTS.has(defOf(fdef.innerType)?.type ?? '')) out.push(`${path}.${key}`);
                optionalDefaults(field, `${path}.${key}`, seen, out);
            }
            return;
        case 'optional':
        case 'nullable':
        case 'default':
        case 'prefault':
        case 'catch':
        case 'readonly':
            optionalDefaults(def.innerType, path, seen, out);
            return;
        case 'array':
            optionalDefaults(def.element, `${path}[]`, seen, out);
            return;
        case 'union':
            (def.options ?? []).forEach((o, i) => optionalDefaults(o, `${path}|${i}`, seen, out));
            return;
        case 'pipe':
            optionalDefaults(def.in, path, seen, out);
            optionalDefaults(def.out, path, seen, out);
            return;
        default:
            return;
    }
}

describe('partialPatch', () => {
    const base = z.object({
        enabled: z.boolean().default(true),
        tags: z.array(z.string()).prefault([]),
        name: z.string(),
    });

    it('lo que no llega queda afuera (como en Zod 3)', () => {
        const patch = partialPatch(base.partial());
        expect(patch.parse({})).toEqual({});
        expect(patch.parse({ name: 'x' })).toEqual({ name: 'x' });
        expect(Object.keys(patch.parse({ enabled: false }))).toEqual(['enabled']);
    });

    it('lo que llega se valida igual', () => {
        const patch = partialPatch(base.partial());
        expect(patch.parse({ tags: ['a'] })).toEqual({ tags: ['a'] });
        expect(patch.safeParse({ enabled: 'no' }).success).toBe(false);
    });

    it('sin el arreglo, Zod 4 rellenaba lo que no llegaba', () => {
        expect(base.partial().parse({})).toEqual({ enabled: true, tags: [] });
    });

    it('ningún esquema exportado rellena con su valor de fábrica un campo opcional', () => {
        const found: string[] = [];
        const seen = new Set<unknown>();
        for (const [name, value] of Object.entries(shared)) {
            if (value && typeof value === 'object' && '_zod' in value) optionalDefaults(value, name, seen, found);
        }
        expect(found).toEqual([]);
    });
});
