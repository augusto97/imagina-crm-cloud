import { describe, expect, it } from 'vitest';

import { actionText, actorOf, agentActivityText } from '@/admin/activity/activityText';
import type { ActivityEntity } from '@/types/activity';

import { runStatusTone, shortTokens, stepKindLabel } from './agentUi';

const entry = (over: Partial<ActivityEntity>): ActivityEntity => ({
    id: 1,
    list_id: 1,
    record_id: 1,
    user_id: null,
    user_name: null,
    action: 'record_updated',
    changes: {},
    created_at: '2026-10-26 12:00:00',
    ...over,
});

describe('E6 — agentes de IA en la interfaz', () => {
    it('la actividad nombra al agente (solo, o por la propuesta que aplicó una persona)', () => {
        expect(actorOf(entry({ agent: { id: 3, name: 'Clasificador' } }))).toBe('El agente «Clasificador»');
        expect(actorOf(entry({ agent: { id: 3, name: 'Clasificador' }, user_id: 2, user_name: 'Ana' }))).toBe('Ana (propuesta del agente «Clasificador»)');
        expect(actorOf(entry({ user_id: 2, user_name: 'Ana' }))).toBe('Ana');
    });

    it('las entradas `ai_agent` se leen en lenguaje claro', () => {
        const note = entry({ action: 'ai_agent', changes: { agent: { event: 'note', agent_id: 3, agent_name: 'X', visibility: 'internal', excerpt: 'Prioridad alta' } } });
        expect(actionText(note, 0)).toBe('dejó una nota interna: «Prioridad alta»');
        const proposed = entry({ action: 'ai_agent', changes: { agent: { event: 'proposed', agent_id: 3, agent_name: 'X', count: 2, summary: 'Cambiar campos · Nota interna' } } });
        expect(agentActivityText(proposed)).toBe('propone 2 cambios: Cambiar campos · Nota interna');
        expect(agentActivityText(entry({ action: 'ai_agent', changes: { agent: { event: 'applied', agent_id: 3, agent_name: 'X' } } }))).toBe('aplicó la propuesta del agente «X»');
        // Un diff roto no rompe la ficha.
        expect(agentActivityText(entry({ action: 'ai_agent', changes: { agent: 'basura' } }))).toBe('trabajó en este registro');
    });

    it('etiquetas y números cortos', () => {
        expect(shortTokens(950)).toBe('950');
        expect(shortTokens(1_250)).toBe('1,3 mil');
        expect(shortTokens(2_000_000)).toBe('2 M');
        expect(runStatusTone('failed')).toBe('destructive');
        expect(runStatusTone('stopped')).toBe('warning');
        expect(stepKindLabel('blocked')).toBe('Bloqueado');
    });
});
