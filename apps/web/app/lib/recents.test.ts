import { describe, expect, it } from 'vitest';

import { mergeRecent, RECENTS_MAX, type RecentItem } from '@/lib/recents';

const item = (id: number, over: Partial<RecentItem> = {}): RecentItem => ({
    kind: 'list',
    id,
    label: `Lista ${id}`,
    href: `/lists/l${id}/records`,
    ts: id,
    ...over,
});

describe('recientes de la paleta', () => {
    it('lo último abierto va primero, sin duplicados, con tope', () => {
        let list: RecentItem[] = [];
        for (let i = 1; i <= RECENTS_MAX + 3; i++) list = mergeRecent(list, item(i));
        list = mergeRecent(list, item(RECENTS_MAX + 1));
        expect(list).toHaveLength(RECENTS_MAX);
        expect(list[0]!.id).toBe(RECENTS_MAX + 1);
        expect(new Set(list.map((r) => r.id)).size).toBe(RECENTS_MAX);
    });

    it('lista y registro con el mismo id son items distintos', () => {
        const list = mergeRecent([item(5)], item(5, { kind: 'record', label: 'Acme' }));
        expect(list.map((r) => r.kind)).toEqual(['record', 'list']);
    });

    it('un label de respaldo no pisa el título real del registro', () => {
        const real = item(9, { kind: 'record', label: 'Acme S.A.', context: 'Clientes' });
        const list = mergeRecent([real], item(9, { kind: 'record', label: 'Registro #9', fallback: true }));
        expect(list[0]).toMatchObject({ label: 'Acme S.A.', context: 'Clientes', fallback: false });
        // Y uno real sí reemplaza al de respaldo.
        const upgraded = mergeRecent(list, item(9, { kind: 'record', label: 'Acme Ltda.' }));
        expect(upgraded[0]!.label).toBe('Acme Ltda.');
    });
});
