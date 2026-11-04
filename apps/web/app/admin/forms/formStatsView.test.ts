import { describe, expect, it } from 'vitest';

import { formConfigSchema, summarizeFormStats } from '@imagina-base/shared';

import type { FieldEntity } from '@/types/field';

import { durationLabel, funnelRows, percentLabel, questionLabel } from './formStatsView';

describe('v0.1.358 — cómo se leen las estadísticas del formulario', () => {
    it('el embudo: vieron → empezaron → pasos desde el 2 → enviaron', () => {
        const stats = summarizeFormStats(
            [{ day: '2026-11-01', counts: { v: 20, s: 10, sub: 4, 'st:1': 10, 'st:2': 6, 'st:3': 5 } }],
            { from: '2026-11-01', to: '2026-11-01' },
        );
        const rows = funnelRows(stats);
        expect(rows.map((r) => r.label)).toEqual(['Lo vieron', 'Empezaron a responder', 'Llegaron al paso 2', 'Llegaron al paso 3', 'Lo enviaron']);
        expect(rows.map((r) => r.share)).toEqual([1, 0.5, 0.3, 0.25, 0.2]);
        // Sin visitas no hay porcentajes inventados.
        const empty = funnelRows(summarizeFormStats([], { from: '2026-11-01', to: '2026-11-01' }));
        expect(empty.every((r) => r.share === null)).toBe(true);
    });

    it('el nombre de la pregunta, la del campo o «ya no está»', () => {
        const config = formConfigSchema.parse({
            items: [
                { id: 'qaa1', type: 'field', field_id: 7 },
                { id: 'qaa2', type: 'field', field_id: 8, label: 'Tu teléfono' },
            ],
        });
        const fields = [{ id: 7, label: 'Nombre' }] as unknown as FieldEntity[];
        expect(questionLabel('qaa1', config, fields)).toBe('Nombre');
        expect(questionLabel('qaa2', config, fields)).toBe('Tu teléfono');
        expect(questionLabel('qaa9', config, fields)).toBe('Una pregunta que ya no está');
    });

    it('tiempos y porcentajes en palabras', () => {
        expect(durationLabel(null)).toBe('—');
        expect(durationLabel(45)).toBe('45 s');
        expect(durationLabel(130)).toBe('2 min 10 s');
        expect(durationLabel(3900)).toBe('1 h 5 min');
        expect(percentLabel(null)).toBe('—');
        expect(percentLabel(0.38)).toBe('38 %');
        expect(percentLabel(0.052)).toBe('5,2 %');
    });
});
