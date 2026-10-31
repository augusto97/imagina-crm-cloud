import { describe, expect, it } from 'vitest';
import type { ListSuggestion } from '@imagina-base/shared';

import type { IdeaDef } from '@/admin/ideas/types';

import { ideaKey, ideaSuggestions, splitSuggestions } from './suggestionsModel';

const s = (key: string, source: 'rules' | 'ai', status: ListSuggestion['status'] = 'new'): ListSuggestion => ({
    key,
    source,
    category: 'view',
    title: key,
    why: 'porque sí',
    action: { type: 'apply', label: 'Crear' },
    preview: null,
    status,
    applied: null,
});

describe('sugerencias por lista en la pantalla', () => {
    it('suma las ideas que encajan con su estado y cuenta sólo lo nuevo', () => {
        const ideas = [{ id: 'aviso-vencimiento', title: 'Aviso', summary: 'Te avisa' }, { id: 'otra', title: 'Otra', summary: 'x' }, { id: 'tercera', title: 'T', summary: 'y' }] as unknown as IdeaDef[];
        const fromIdeas = ideaSuggestions(ideas, 'facturas', { [ideaKey('otra')]: 'dismissed' });
        expect(fromIdeas).toHaveLength(2);
        expect(fromIdeas[0]!.action).toEqual({ type: 'link', label: 'Ver y activar', href: '/ideas/aviso-vencimiento?lista=facturas' });
        expect(fromIdeas[1]!.status).toBe('dismissed');

        const split = splitSuggestions({ suggestions: [s('view.kanban.f1', 'rules'), s('ai.1', 'ai'), s('ai.2', 'ai', 'applied'), s('share.form', 'rules', 'dismissed')] }, fromIdeas);
        expect(split.rules.map((x) => x.key)).toEqual(['view.kanban.f1', 'idea.aviso-vencimiento']);
        expect(split.ai.map((x) => x.key)).toEqual(['ai.1']);
        expect(split.dismissed.map((x) => x.key)).toEqual(['share.form', 'idea.otra']);
        expect(split.applied.map((x) => x.key)).toEqual(['ai.2']);
        expect(split.newCount).toBe(3);
    });

    it('la clave de una idea es válida para el servidor', () => {
        expect(ideaKey('Aviso Pago_2')).toBe('idea.aviso-pago_2');
        expect(/^[a-z][a-z0-9_.:-]{1,119}$/.test(ideaKey('recordatorio-de-pago'))).toBe(true);
    });
});
