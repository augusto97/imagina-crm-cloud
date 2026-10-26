import { describe, expect, it } from 'vitest';
import {
    aiEffortLevels,
    aiModelChoiceSchema,
    clampAiEffort,
    buildAiModelCatalog,
    compareAiModels,
    inferAiModelCaps,
    legacyModelToChoice,
    parseAiModelId,
    resolveAiModelChoice,
    type AiModelCaps,
} from './ai-models';

// Ids inventados a propósito (familias reales, versiones que no existen):
// la lógica no depende de ningún modelo concreto.
const caps = (over: Partial<AiModelCaps> = {}): AiModelCaps => ({
    adaptive_thinking: true,
    budget_thinking: false,
    effort: true,
    image_input: true,
    pdf_input: true,
    ...over,
});
const m = (id: string, display_name: string, created_at: string | null = null) => ({ id, display_name, created_at, max_input_tokens: 1_000_000, caps: caps() });

const catalog = buildAiModelCatalog([
    m('claude-opus-9', 'Claude Opus 9', '2030-01-01T00:00:00Z'),
    m('claude-haiku-8-5-20290101', 'Claude Haiku 8.5', '2029-01-01T00:00:00Z'),
    m('claude-opus-9-5', 'Claude Opus 9.5', '2030-06-01T00:00:00Z'),
    m('claude-sonnet-9-5', 'Claude Sonnet 9.5', '2030-06-01T00:00:00Z'),
    m('claude-haiku-9-5', 'Claude Haiku 9.5', '2030-06-01T00:00:00Z'),
    m('claude-mythos-preview', 'Claude Mythos Preview', '2030-02-01T00:00:00Z'),
    m('claude-nuevo-1', 'Claude Nuevo 1', '2030-07-01T00:00:00Z'),
]).models;

describe('modelos del asistente (catálogo dinámico)', () => {
    it('parsea familia, versión y fecha; lo que no sigue el patrón no tiene familia', () => {
        expect(parseAiModelId('claude-opus-9-5')).toEqual({ family: 'opus', version: [9, 5], date: null });
        expect(parseAiModelId('claude-opus-9')).toEqual({ family: 'opus', version: [9, 0], date: null });
        expect(parseAiModelId('claude-haiku-8-5-20290101')).toEqual({ family: 'haiku', version: [8, 5], date: '20290101' });
        expect(parseAiModelId('claude-mythos-preview')).toBeNull();
    });

    it('ordena por versión (no por orden alfabético ni por fecha de alta) y marca el más reciente de cada familia', () => {
        const opus = catalog.filter((x) => x.family === 'opus');
        expect(opus.map((x) => x.id)).toEqual(['claude-opus-9-5', 'claude-opus-9']);
        expect(opus.map((x) => x.latest)).toEqual([true, false]);
        expect(compareAiModels({ id: 'claude-x-10', created_at: null }, { id: 'claude-x-9-9', created_at: null })).toBeLessThan(0);
    });

    it('arma las familias en el orden de muestra, con la etiqueta derivada del nombre; una familia nueva aparece sola', () => {
        const { families } = buildAiModelCatalog(catalog);
        expect(families.map((f) => [f.family, f.label, f.latest_id])).toEqual([
            ['opus', 'Opus', 'claude-opus-9-5'],
            ['sonnet', 'Sonnet', 'claude-sonnet-9-5'],
            ['haiku', 'Haiku', 'claude-haiku-9-5'],
            ['nuevo', 'Nuevo', 'claude-nuevo-1'],
        ]);
    });

    it('«el más reciente» se resuelve contra el catálogo y cambia solo cuando aparece uno nuevo', () => {
        expect(resolveAiModelChoice('auto:opus', catalog)).toMatchObject({ id: 'claude-opus-9-5', fallback_from: null });
        const later = buildAiModelCatalog([...catalog, m('claude-opus-10', 'Claude Opus 10')]).models;
        expect(resolveAiModelChoice('auto:opus', later)?.id).toBe('claude-opus-10');
    });

    it('una familia que la clave no ve cae a la primera familia conocida, avisando', () => {
        expect(resolveAiModelChoice('auto:fable', catalog)).toMatchObject({ id: 'claude-opus-9-5', fallback_from: 'auto:fable' });
    });

    it('una versión fija se respeta; con o sin sufijo de fecha es el mismo modelo', () => {
        expect(resolveAiModelChoice('claude-opus-9', catalog)).toMatchObject({ id: 'claude-opus-9', fallback_from: null });
        expect(resolveAiModelChoice('claude-haiku-8-5', catalog)).toMatchObject({ id: 'claude-haiku-8-5-20290101', fallback_from: null });
    });

    it('una versión fija retirada pasa al más reciente de su familia, avisando', () => {
        expect(resolveAiModelChoice('claude-sonnet-7', catalog)).toMatchObject({ id: 'claude-sonnet-9-5', fallback_from: 'claude-sonnet-7' });
    });

    it('sin catálogo: un id fijo se usa tal cual y «el más reciente» no se puede resolver', () => {
        expect(resolveAiModelChoice('claude-opus-9', [])).toMatchObject({ id: 'claude-opus-9', caps: null });
        expect(resolveAiModelChoice('auto:opus', [])).toBeNull();
    });

    it('lo que guardaban las versiones anteriores pasa a «el más reciente» de esa familia', () => {
        expect(legacyModelToChoice('claude-sonnet-1')).toBe('auto:sonnet');
        expect(legacyModelToChoice('claude-haiku-1-5')).toBe('auto:haiku');
        expect(legacyModelToChoice('cualquier cosa')).toBeNull();
        expect(legacyModelToChoice(null)).toBeNull();
    });

    it('la elección valida la forma, no la existencia', () => {
        expect(aiModelChoiceSchema.safeParse('auto:opus').success).toBe(true);
        expect(aiModelChoiceSchema.safeParse('claude-opus-9-5').success).toBe(true);
        expect(aiModelChoiceSchema.safeParse('gpt-4').success).toBe(false);
        expect(aiModelChoiceSchema.safeParse('auto:').success).toBe(false);
    });

    it('sin capacidades informadas: adaptativo desde la 4.6, presupuesto fijo antes', () => {
        expect(inferAiModelCaps('claude-haiku-4-2')).toMatchObject({ adaptive_thinking: false, budget_thinking: true, effort: false });
        expect(inferAiModelCaps('claude-sonnet-4-9')).toMatchObject({ adaptive_thinking: true, budget_thinking: false, effort: true });
        expect(inferAiModelCaps('claude-haiku-9-5')).toMatchObject({ adaptive_thinking: true, effort: true });
    });
    it('v0.1.306 — niveles de esfuerzo: los declarados, el juego habitual si no dice, ninguno sin esfuerzo', () => {
        expect(aiEffortLevels(caps({ effort: true, effort_levels: ['low', 'medium', 'high', 'xhigh', 'max'] }))).toEqual(['low', 'medium', 'high', 'xhigh', 'max']);
        expect(aiEffortLevels(caps({ effort: true, effort_levels: null }))).toEqual(['low', 'medium', 'high', 'max']);
        // Catálogo cacheado por la versión anterior: sin la clave.
        expect(aiEffortLevels({ ...caps({ effort: true }), effort_levels: undefined })).toEqual(['low', 'medium', 'high', 'max']);
        expect(aiEffortLevels(caps({ effort: false, effort_levels: ['low'] }))).toEqual([]);
        expect(aiEffortLevels(null)).toEqual([]);
    });

    it('v0.1.306 — un nivel que el modelo no tiene va al más cercano (el menor ante un empate)', () => {
        const some = caps({ effort: true, effort_levels: ['low', 'medium', 'high', 'max'] });
        expect(clampAiEffort('xhigh', some)).toBe('high');
        expect(clampAiEffort('medium', some)).toBe('medium');
        expect(clampAiEffort('max', caps({ effort: true, effort_levels: ['low', 'medium'] }))).toBe('medium');
        expect(clampAiEffort('low', caps({ effort: true, effort_levels: ['high', 'max'] }))).toBe('high');
        expect(clampAiEffort('high', caps({ effort: false }))).toBeNull();
    });
});
