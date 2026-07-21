import { describe, expect, it } from 'vitest';

import type { ActionSpec } from '@/types/automation';

import {
    branchOf,
    duplicateAt,
    getNode,
    ifElseDepth,
    insertAt,
    removeAt,
    updateNode,
} from './actionsTree';

const email = (to: string): ActionSpec => ({ type: 'send_email', config: { to } });

function tree(): ActionSpec[] {
    return [
        email('a@x.com'),
        {
            type: 'if_else',
            config: {
                condition: [{ slug: 'estado', op: 'equals', value: 'pendiente' }],
                then_actions: [email('then@x.com')],
                else_actions: [],
            },
        },
        email('z@x.com'),
    ];
}

describe('actionsTree', () => {
    it('getNode resuelve paths anidados', () => {
        const t = tree();
        expect(getNode(t, [0])?.config.to).toBe('a@x.com');
        expect(getNode(t, [1, 'then', 0])?.config.to).toBe('then@x.com');
        expect(getNode(t, [1, 'else', 0])).toBeUndefined();
        expect(getNode(t, [9])).toBeUndefined();
    });

    it('insertAt inserta en la raíz y dentro de una rama sin mutar el original', () => {
        const t = tree();
        const root = insertAt(t, [], 1, email('new@x.com'));
        expect(root.map((a) => a.config.to)).toEqual(['a@x.com', 'new@x.com', undefined, 'z@x.com']);

        const branch = insertAt(t, [1, 'else'], 0, email('nope@x.com'));
        expect(branchOf(branch[1]!, 'else')[0]?.config.to).toBe('nope@x.com');
        // Original intacto (inmutable)
        expect(branchOf(t[1]!, 'else')).toHaveLength(0);
        expect(t).toHaveLength(3);
    });

    it('updateNode reemplaza un nodo anidado', () => {
        const t = tree();
        const next = updateNode(t, [1, 'then', 0], email('edited@x.com'));
        expect(branchOf(next[1]!, 'then')[0]?.config.to).toBe('edited@x.com');
        expect(branchOf(t[1]!, 'then')[0]?.config.to).toBe('then@x.com');
    });

    it('removeAt y duplicateAt operan en la secuencia correcta', () => {
        const t = tree();
        const removed = removeAt(t, [1, 'then', 0]);
        expect(branchOf(removed[1]!, 'then')).toHaveLength(0);
        expect(removed).toHaveLength(3);

        const dup = duplicateAt(t, [0]);
        expect(dup).toHaveLength(4);
        expect(dup[1]?.config.to).toBe('a@x.com');
    });

    it('ifElseDepth cuenta los niveles de rama', () => {
        expect(ifElseDepth([])).toBe(0);
        expect(ifElseDepth([1, 'then'])).toBe(1);
        expect(ifElseDepth([1, 'then', 0, 'else'])).toBe(2);
    });
});
