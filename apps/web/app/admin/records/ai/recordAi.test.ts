import { describe, expect, it } from 'vitest';
import { RECORD_AI_REWRITE_ACTIONS, type RecordAgentRunDto } from '@imagina-base/shared';

import { AI_REWRITE_GROUPS } from '../description/AiWritePanel';
import { filterCommands } from '../description/slashCommands';
import { agentRunText } from './RecordAi';

const run = (over: Partial<RecordAgentRunDto>): RecordAgentRunDto => ({
    id: 1,
    agent_id: 2,
    agent_name: 'Clasificador',
    status: 'queued',
    summary: '',
    error: null,
    writes: 0,
    proposal: null,
    created_by_name: 'Ana',
    created_at: '2026-11-19 10:00:00',
    finished_at: null,
    ...over,
});

describe('v0.1.456 — IA en la ficha', () => {
    it('la barra flotante ofrece cada acción de reescribir una sola vez', () => {
        const all = AI_REWRITE_GROUPS.flatMap((g) => g.actions);
        expect([...all].sort()).toEqual([...RECORD_AI_REWRITE_ACTIONS].sort());
        expect(new Set(all).size).toBe(all.length);
    });

    it('«Escribir con IA» está en el menú «/» y se encuentra sin acentos', () => {
        expect(filterCommands('').some((c) => c.action === 'aiWrite')).toBe(true);
        expect(filterCommands('ia').some((c) => c.action === 'aiWrite')).toBe(true);
        expect(filterCommands('redactar').some((c) => c.action === 'aiWrite')).toBe(true);
    });

    it('el estado de una corrida se dice en palabras', () => {
        expect(agentRunText(run({ status: 'queued' })).tone).toBe('busy');
        expect(agentRunText(run({ status: 'running' })).text).toMatch(/Trabajando/);
        const proposed = agentRunText(run({ status: 'success', proposal: { id: 9, status: 'pending', items: 2 }, summary: 'Propuse la prioridad.' }));
        expect(proposed.text).toMatch(/propuesta con 2 cambios/);
        expect(proposed.detail).toBe('Propuse la prioridad.');
        expect(agentRunText(run({ status: 'success', writes: 1 })).text).toMatch(/hizo 1 cambio/);
        expect(agentRunText(run({ status: 'success' })).text).toMatch(/sin cambios/);
        const failed = agentRunText(run({ status: 'failed', error: 'Sin IA disponible: la empresa no activó el asistente.' }));
        expect(failed.tone).toBe('error');
        expect(failed.detail).toMatch(/Sin IA disponible/);
        expect(agentRunText(run({ status: 'skipped', error: 'Se detuvo el lote antes de que arrancara.' })).tone).toBe('warn');
    });
});
