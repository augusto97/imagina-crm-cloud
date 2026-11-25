import { describe, expect, it } from 'vitest';

import type { ActionSpec } from '@/types/automation';

import { summarizeAction } from './automationMeta';

/** v0.1.467 (E8) — las esperas por el horario laboral, en palabras (índice, flujo y lienzo). */
describe('v0.1.467 — esperar hasta un día laborable / el horario laboral', () => {
    it('resume cada modo como lo lee la persona', () => {
        const hours: ActionSpec = { type: 'wait', config: { mode: 'business_hours' } };
        const day: ActionSpec = { type: 'wait', config: { mode: 'business_day' } };
        const dayAt: ActionSpec = { type: 'wait', config: { mode: 'business_day', at_time: '09:30' } };
        expect(summarizeAction(hours, [], [])).toBe('Espera hasta el horario laboral');
        expect(summarizeAction(day, [], [])).toBe('Espera hasta un día laborable');
        expect(summarizeAction(dayAt, [], [])).toBe('Espera hasta un día laborable a las 09:30');
    });

    it('un modo desconocido no se lee como uno de horario', () => {
        expect(summarizeAction({ type: 'wait', config: { mode: 'raro', amount: 2, unit: 'hours' } }, [], [])).toBe('Espera 2 horas');
    });
});
