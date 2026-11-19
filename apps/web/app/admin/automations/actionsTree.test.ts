import { describe, expect, it } from 'vitest';

import type { ActionSpec } from '@/types/automation';

import {
    branchOf,
    duplicateAt,
    getNode,
    ifElseDepth,
    insertAt,
    insideFail,
    insideLoop,
    removeAt,
    stepsBefore,
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

describe('actionsTree — repetir por cada vinculado (v0.1.288)', () => {
    const loop = (): ActionSpec[] => [
        { type: 'call_webhook', config: { url: 'https://a.example', response_name: 'cotizacion' } },
        {
            type: 'for_each_linked',
            config: { relation_field_id: 5, actions: [email('item@x.com')] },
        },
        email('fin@x.com'),
    ];

    it('la rama each apunta a config.actions', () => {
        const t = loop();
        expect(getNode(t, [1, 'each', 0])?.config.to).toBe('item@x.com');
        const ins = insertAt(t, [1, 'each'], 1, email('otro@x.com'));
        expect(branchOf(ins[1]!, 'each').map((a) => a.config.to)).toEqual(['item@x.com', 'otro@x.com']);
        expect(branchOf(t[1]!, 'each')).toHaveLength(1);
        expect(insideLoop([1, 'each'])).toBe(true);
        expect(insideLoop([1, 'then'])).toBe(false);
        expect(ifElseDepth([1, 'each'])).toBe(1);
    });

    it('stepsBefore devuelve los pasos previos (también los anidados)', () => {
        const t = loop();
        expect(stepsBefore(t, [0])).toHaveLength(0);
        expect(stepsBefore(t, [1, 'each', 0]).map((a) => a.spec.type)).toEqual(['call_webhook']);
        expect(stepsBefore(t, [2]).map((a) => a.spec.type)).toEqual(['call_webhook', 'for_each_linked', 'send_email']);
        expect(stepsBefore(t, [2]).map((a) => a.path.join('.'))).toEqual(['0', '1', '1.each.0']);
    });
});

describe('actionsTree — «Según el valor de…» y «Si este paso falla» (v0.1.460)', () => {
    const flow = (): ActionSpec[] => [
        {
            type: 'switch',
            config: {
                source_field_id: 7,
                cases: [
                    { label: 'Nuevo', op: 'eq', value: 'nuevo', actions: [email('nuevo@x.com')] },
                    { label: 'Viejo', op: 'eq', value: 'viejo', actions: [] },
                ],
                default_actions: [email('otro@x.com')],
            },
        },
        {
            type: 'call_webhook',
            config: { url: 'https://a.example', response_name: 'erp' },
            on_error: { mode: 'steps', actions: [email('error@x.com')] },
        },
        email('fin@x.com'),
    ];

    it('cada rama del switch y «En otro caso» se direccionan', () => {
        const t = flow();
        expect(getNode(t, [0, 'case0', 0])?.config.to).toBe('nuevo@x.com');
        expect(getNode(t, [0, 'default', 0])?.config.to).toBe('otro@x.com');
        const ins = insertAt(t, [0, 'case1'], 0, email('viejo@x.com'));
        expect(branchOf(ins[0]!, 'case1').map((a) => a.config.to)).toEqual(['viejo@x.com']);
        // Inmutable: la rama original sigue vacía y las demás intactas.
        expect(branchOf(t[0]!, 'case1')).toHaveLength(0);
        expect(branchOf(ins[0]!, 'case0').map((a) => a.config.to)).toEqual(['nuevo@x.com']);
        const rem = removeAt(t, [0, 'default', 0]);
        expect(branchOf(rem[0]!, 'default')).toHaveLength(0);
        expect(ifElseDepth([0, 'case1'])).toBe(1);
    });

    it('los pasos de «Si falla» viven en on_error.actions', () => {
        const t = flow();
        expect(getNode(t, [1, 'fail', 0])?.config.to).toBe('error@x.com');
        const ins = insertAt(t, [1, 'fail'], 1, email('soporte@x.com'));
        expect((ins[1]!.on_error as { actions: ActionSpec[] }).actions.map((a) => a.config.to)).toEqual(['error@x.com', 'soporte@x.com']);
        expect((ins[1]!.on_error as { mode: string }).mode).toBe('steps');
        expect(insideFail([1, 'fail'])).toBe(true);
        expect(insideFail([0, 'case0'])).toBe(false);
    });

    it('stepsBefore: dentro de «Si falla» cuenta el paso que falló; después, las ramas previas', () => {
        const t = flow();
        expect(stepsBefore(t, [1, 'fail', 0]).map((s) => s.path.join('.'))).toEqual(['0', '0.case0.0', '0.default.0', '1']);
        expect(stepsBefore(t, [2]).map((s) => s.path.join('.'))).toEqual(['0', '0.case0.0', '0.default.0', '1', '1.fail.0']);
    });
});
