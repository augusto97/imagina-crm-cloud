import { buildAiModelCatalog, type AiModelCatalog } from '@imagina-base/shared';
import { describe, expect, it } from 'vitest';

import { buildModelOptions, describeModelChoice, effortLabel, effortLevelsForChoice, modelNotes } from './aiModels';

// Ids inventados: la UI no depende de ningún modelo concreto.
const caps = { adaptive_thinking: true, budget_thinking: false, effort: true, image_input: true, pdf_input: true };
const built = buildAiModelCatalog([
    { id: 'claude-opus-9-5', display_name: 'Claude Opus 9.5', created_at: null, max_input_tokens: null, caps },
    { id: 'claude-opus-9', display_name: 'Claude Opus 9', created_at: null, max_input_tokens: null, caps },
    { id: 'claude-haiku-9-5', display_name: 'Claude Haiku 9.5', created_at: null, max_input_tokens: null, caps },
    { id: 'claude-mythos-preview', display_name: 'Claude Mythos Preview', created_at: null, max_input_tokens: null, caps },
]);
const catalog: AiModelCatalog = { ...built, no_key: false, fetched_at: '2026-10-26T00:00:00Z', error: null };

describe('selector de modelo (catálogo del proveedor)', () => {
    it('primero «el más reciente» por familia (con el modelo de hoy), después las versiones fijas', () => {
        const groups = buildModelOptions(catalog, 'auto:opus');
        expect(groups[0]!.options).toEqual([
            { value: 'auto:opus', label: 'Opus más reciente — ahora Claude Opus 9.5' },
            { value: 'auto:haiku', label: 'Haiku más reciente — ahora Claude Haiku 9.5' },
        ]);
        expect(groups.map((g) => g.label)).toEqual([
            'Siempre el más reciente (se actualiza solo)',
            'Versión fija · Opus',
            'Versión fija · Haiku',
            'Otros modelos',
        ]);
        expect(groups[1]!.options[0]).toEqual({ value: 'claude-opus-9-5', label: 'Claude Opus 9.5 · la más reciente' });
    });

    it('sin clave ofrece las familias de siempre como «el más reciente», sin inventar versiones', () => {
        const groups = buildModelOptions({ models: [], families: [], no_key: true, fetched_at: null, error: null }, 'auto:opus');
        expect(groups).toHaveLength(1);
        expect(groups[0]!.options.map((o) => o.value)).toEqual(['auto:opus', 'auto:sonnet', 'auto:haiku']);
    });

    it('una elección que la clave ya no ve se muestra igual (para no perderla) y se explica qué se usa', () => {
        const groups = buildModelOptions(catalog, 'claude-opus-7');
        expect(groups[0]).toEqual({ label: 'Elegido', options: [{ value: 'claude-opus-7', label: 'claude-opus-7 (no disponible para esta clave)' }] });
        const notes = modelNotes(catalog, 'claude-opus-7', 'hace 2 h');
        expect(notes[0]).toEqual({ kind: 'warning', text: 'claude-opus-7 no está disponible para esta clave: se usa Claude Opus 9.5.' });
        expect(notes.at(-1)!.text).toBe('Lista consultada a Anthropic hace 2 h · 4 modelos disponibles.');
    });

    it('una versión fija avisa que no cambia sola; un error del proveedor se dice', () => {
        expect(modelNotes(catalog, 'claude-opus-9', null)[0]!.text).toContain('Versión fija');
        expect(modelNotes({ ...catalog, error: 'caído' }, 'auto:opus', null)[0]).toEqual({
            kind: 'warning',
            text: 'No se pudo actualizar la lista (caído). Se muestra la última conocida.',
        });
        expect(describeModelChoice('auto:sonnet', catalog)).toBe('Sonnet más reciente');
    });
});

describe('nivel de esfuerzo (v0.1.306)', () => {
    const withLevels = buildAiModelCatalog([
        { id: 'claude-opus-9-5', display_name: 'Claude Opus 9.5', created_at: null, max_input_tokens: null, caps: { ...caps, effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'claude-haiku-3-9', display_name: 'Claude Haiku 3.9', created_at: null, max_input_tokens: null, caps: { ...caps, adaptive_thinking: false, budget_thinking: true, effort: false } },
    ]);
    const cat: AiModelCatalog = { ...withLevels, no_key: false, fetched_at: null, error: null };

    it('ofrece los niveles del modelo que resulta de la elección', () => {
        expect(effortLevelsForChoice('auto:opus', cat)).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
        // Un modelo que piensa con presupuesto fijo no usa esfuerzo.
        expect(effortLevelsForChoice('auto:haiku', cat)).toEqual([]);
        // Sin catálogo todavía: «el más reciente» no se sabe; una versión fija se infiere del id.
        expect(effortLevelsForChoice('auto:opus', undefined)).toBeNull();
        expect(effortLevelsForChoice('claude-sonnet-4-1', undefined)).toEqual([]);
        // Un modelo que acepta esfuerzo sin informar niveles: el juego habitual.
        expect(effortLevelsForChoice('auto:opus', catalog)).toEqual(['low', 'medium', 'high', 'max']);
    });

    it('nombra cada nivel en español', () => {
        expect(['low', 'medium', 'high', 'xhigh', 'max'].map((l) => effortLabel(l as never))).toEqual(['Bajo', 'Medio', 'Alto', 'Muy alto', 'Máximo']);
    });
});
