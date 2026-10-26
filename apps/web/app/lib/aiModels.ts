import {
    AI_AUTO_PREFIX,
    AI_MODEL_FAMILY_ORDER,
    aiChoiceFamily,
    aiEffortLevels,
    aiFamilyLabelFallback,
    inferAiModelCaps,
    isAutoModelChoice,
    resolveAiModelChoice,
    type AiEffort,
    type AiModelCatalog,
} from '@imagina-base/shared';

import { __, sprintf } from '@/lib/i18n';

/**
 * Opciones del selector de modelo (ADR-S60). Puro: arma lo que se ve a
 * partir del catálogo que devolvió el proveedor, así un modelo nuevo
 * aparece sin tocar la app.
 */

export interface ModelOption {
    value: string;
    label: string;
}
export interface ModelOptionGroup {
    label: string;
    options: ModelOption[];
}

/** Familias que se ofrecen como «el más reciente» cuando todavía no hay catálogo (sin clave). */
const FAMILIES_WITHOUT_CATALOG = AI_MODEL_FAMILY_ORDER.filter((f) => f !== 'fable');

function familyLabel(catalog: AiModelCatalog | undefined, family: string): string {
    return catalog?.families.find((f) => f.family === family)?.label ?? aiFamilyLabelFallback(family);
}

/** «Opus más reciente — ahora <nombre del modelo>», o el nombre del modelo fijo. */
export function describeModelChoice(choice: string, catalog: AiModelCatalog | undefined): string {
    if (isAutoModelChoice(choice)) {
        const family = aiChoiceFamily(choice) ?? '';
        const fam = catalog?.families.find((f) => f.family === family);
        const base = sprintf(/* translators: %s: model family, e.g. Opus */ __('%s más reciente'), familyLabel(catalog, family));
        return fam ? `${base} — ${sprintf(/* translators: %s: model name */ __('ahora %s'), fam.latest_name)}` : base;
    }
    return catalog?.models.find((m) => m.id === choice)?.display_name ?? choice;
}

export function buildModelOptions(catalog: AiModelCatalog | undefined, value: string): ModelOptionGroup[] {
    const groups: ModelOptionGroup[] = [];
    const families = catalog && catalog.families.length > 0 ? catalog.families.map((f) => f.family) : [...FAMILIES_WITHOUT_CATALOG];
    groups.push({
        label: __('Siempre el más reciente (se actualiza solo)'),
        options: families.map((f) => ({ value: `${AI_AUTO_PREFIX}${f}`, label: describeModelChoice(`${AI_AUTO_PREFIX}${f}`, catalog) })),
    });
    for (const fam of catalog?.families ?? []) {
        const models = catalog!.models.filter((m) => m.family === fam.family);
        if (models.length === 0) continue;
        groups.push({
            label: sprintf(/* translators: %s: model family */ __('Versión fija · %s'), fam.label),
            options: models.map((m) => ({ value: m.id, label: m.latest ? `${m.display_name} · ${__('la más reciente')}` : m.display_name })),
        });
    }
    const others = (catalog?.models ?? []).filter((m) => m.family === null);
    if (others.length > 0) {
        groups.push({ label: __('Otros modelos'), options: others.map((m) => ({ value: m.id, label: m.display_name })) });
    }
    const all = new Set(groups.flatMap((g) => g.options.map((o) => o.value)));
    if (value && !all.has(value)) {
        groups.unshift({
            label: __('Elegido'),
            options: [{ value, label: `${describeModelChoice(value, catalog)} (${__('no disponible para esta clave')})` }],
        });
    }
    return groups;
}

export type ModelNote = { kind: 'info' | 'warning'; text: string };

/**
 * Lo que se explica bajo el selector: qué pasa con la elección y si la lista
 * está al día. `fetchedLabel` es la fecha relativa ya formateada.
 */
export function modelNotes(catalog: AiModelCatalog | undefined, value: string, fetchedLabel: string | null): ModelNote[] {
    if (!catalog) return [];
    const notes: ModelNote[] = [];
    if (catalog.no_key) {
        notes.push({ kind: 'info', text: __('Carga una clave para ver los modelos disponibles. Mientras tanto se usa el más reciente de cada familia.') });
        return notes;
    }
    if (catalog.error) {
        notes.push({
            kind: 'warning',
            text:
                catalog.models.length > 0
                    ? sprintf(/* translators: %s: error */ __('No se pudo actualizar la lista (%s). Se muestra la última conocida.'), catalog.error)
                    : sprintf(/* translators: %s: error */ __('No se pudo consultar la lista de modelos: %s'), catalog.error),
        });
    }
    if (value && catalog.models.length > 0) {
        const resolved = resolveAiModelChoice(value, catalog.models);
        if (resolved?.fallback_from) {
            notes.push({
                kind: 'warning',
                text: sprintf(
                    /* translators: 1: chosen model, 2: model used instead */ __('%1$s no está disponible para esta clave: se usa %2$s.'),
                    describeModelChoice(value, catalog),
                    resolved.display_name,
                ),
            });
        } else if (!isAutoModelChoice(value)) {
            notes.push({
                kind: 'info',
                text: __('Versión fija: no cambia sola. Si Anthropic la retira, se usa la más reciente de su familia.'),
            });
        }
    }
    if (fetchedLabel && catalog.models.length > 0) {
        notes.push({
            kind: 'info',
            text: sprintf(
                /* translators: 1: relative time, 2: number of models */ __('Lista consultada a Anthropic %1$s · %2$d modelos disponibles.'),
                fetchedLabel,
                catalog.models.length,
            ),
        });
    }
    return notes;
}

// ── Nivel de esfuerzo (v0.1.306, ADR-S61) ─────────────────────────────────

/** Nombre corto del nivel («Medio»). */
export function effortLabel(level: AiEffort): string {
    switch (level) {
        case 'low':
            return __('Bajo');
        case 'medium':
            return __('Medio');
        case 'high':
            return __('Alto');
        case 'xhigh':
            return __('Muy alto');
        case 'max':
            return __('Máximo');
    }
}

/** Para qué sirve cada nivel, en una línea. */
export function effortDescription(level: AiEffort): string {
    switch (level) {
        case 'low':
            return __('responde más rápido y gasta menos');
        case 'medium':
            return __('equilibrio entre calidad y velocidad (recomendado)');
        case 'high':
            return __('piensa más los pedidos complejos');
        case 'xhigh':
            return __('para pedidos muy complejos');
        case 'max':
            return __('el más cuidadoso, el más lento y el que más gasta');
    }
}

/**
 * Niveles que acepta el modelo que resulta de una elección (`''` sin
 * catálogo cargado → los que se infieren del id). `null` = todavía no se
 * sabe (catálogo sin cargar y elección «el más reciente»).
 */
export function effortLevelsForChoice(choice: string, catalog: AiModelCatalog | undefined): AiEffort[] | null {
    if (!catalog || catalog.models.length === 0) {
        return isAutoModelChoice(choice) ? null : aiEffortLevels(inferAiModelCaps(choice));
    }
    const resolved = resolveAiModelChoice(choice, catalog.models);
    if (!resolved) return null;
    return aiEffortLevels(resolved.caps ?? inferAiModelCaps(resolved.id));
}
