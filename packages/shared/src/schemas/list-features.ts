import { z } from 'zod';

import { suggestRecordLayoutTemplate, type SuggestLayoutField } from '../templates/record-layout-suggest';

/**
 * v0.1.475 (ADR-S115) — «Funciones de la lista».
 *
 * Cada lista elige qué funciones de la ficha usa: una lista simple (unos
 * clientes, unas anualidades) no necesita subtareas, checklists, registro de
 * tiempo ni el aviso de duplicados; una de proyectos sí. Se guardan en
 * `lists.settings.features` (sin migración de esquema) y se leen con
 * tolerancia por clave.
 *
 * Apagar una función la ESCONDE de la ficha, la tabla y los menús de esa
 * lista; nunca borra datos, y al encenderla vuelve todo. La única excepción
 * son las subtareas: las que ya existen se siguen viendo (si no, quedarían
 * registros sin forma de abrirlos); apagada, sólo deja de ofrecer crear
 * nuevas.
 *
 * Valores de fábrica:
 *  - listas que ya existían (migración 0143): «según el uso» — queda encendido
 *    lo que la lista ya tiene (subtareas, checklists, dependencias, tiempo) y
 *    se apaga lo vacío; la descripción y el resumen con IA quedan encendidos;
 *    los duplicados, sólo si alguien configuró sus reglas a mano;
 *  - listas nuevas en blanco, desde un archivo o de Airtable: sólo la
 *    descripción y el resumen con IA (`LIST_FEATURES_BASE`);
 *  - de una plantilla del sistema: las que esa plantilla declara;
 *  - armadas por la IA: las que sugiere el tipo de lista (`suggestListFeatures`).
 */

export const LIST_FEATURE_KEYS = ['description', 'ai_summary', 'subtasks', 'checklists', 'dependencies', 'time_tracking', 'duplicates'] as const;
export type ListFeatureKey = (typeof LIST_FEATURE_KEYS)[number];
export type ListFeatures = Record<ListFeatureKey, boolean>;

/** Lo que trae una lista nueva en blanco. */
export const LIST_FEATURES_BASE: Readonly<ListFeatures> = Object.freeze({
    description: true,
    ai_summary: true,
    subtasks: false,
    checklists: false,
    dependencies: false,
    time_tracking: false,
    duplicates: false,
});

/** Lo que se lee cuando la lista no dice nada (una lista vieja importada): todo como antes. */
const LEGACY: Readonly<Omit<ListFeatures, 'duplicates'>> = Object.freeze({
    description: true,
    ai_summary: true,
    subtasks: true,
    checklists: true,
    dependencies: true,
    time_tracking: true,
});

/** Para cambiarlas (PATCH): sólo las que llegan. */
export const listFeaturesInputSchema = z
    .object({
        description: z.boolean(),
        ai_summary: z.boolean(),
        subtasks: z.boolean(),
        checklists: z.boolean(),
        dependencies: z.boolean(),
        time_tracking: z.boolean(),
        duplicates: z.boolean(),
    })
    .partial()
    .strict();
export type ListFeaturesInput = z.infer<typeof listFeaturesInputSchema>;

function isRecord(v: unknown): v is Record<string, unknown> {
    return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Sin `features.duplicates`, el aviso de duplicados queda encendido sólo si la
 * lista tiene reglas elegidas a mano (y no lo apagó). Es el criterio de la
 * migración: las reglas sugeridas avisaban en toda lista con un correo o un
 * teléfono, y en las que se repiten a propósito era ruido.
 */
function legacyDuplicates(settings: Record<string, unknown>): boolean {
    const d = settings.duplicates;
    if (!isRecord(d)) return false;
    return Array.isArray(d.rules) && d.enabled !== false;
}

/** Lectura tolerante: una clave que falta o no es booleana toma su valor de siempre. */
export function readListFeatures(settings: Record<string, unknown> | null | undefined): ListFeatures {
    const src = isRecord(settings) ? settings : {};
    const raw = isRecord(src.features) ? src.features : {};
    const out = {} as ListFeatures;
    for (const key of LIST_FEATURE_KEYS) {
        const v = raw[key];
        if (typeof v === 'boolean') out[key] = v;
        else out[key] = key === 'duplicates' ? legacyDuplicates(src) : LEGACY[key];
    }
    return out;
}

/** ¿Está encendida? (atajo para un solo lugar). */
export function listFeatureOn(settings: Record<string, unknown> | null | undefined, key: ListFeatureKey): boolean {
    return readListFeatures(settings)[key];
}

/** Lo guardado más lo que cambia: siempre el objeto entero (así no hay claves a medias). */
export function mergeListFeatures(settings: Record<string, unknown> | null | undefined, patch: ListFeaturesInput): ListFeatures {
    const next = { ...readListFeatures(settings) };
    for (const key of LIST_FEATURE_KEYS) {
        const v = patch[key];
        if (typeof v === 'boolean') next[key] = v;
    }
    return next;
}

/** El objeto entero a partir de la base y lo que se enciende. */
export function listFeaturesWith(...on: ListFeatureKey[]): ListFeatures {
    const out = { ...LIST_FEATURES_BASE };
    for (const key of on) out[key] = true;
    return out;
}

/**
 * Las funciones que le quedan a una lista que arma la IA, por el tipo de lista
 * (el mismo criterio de la ficha sugerida, v0.1.470): trabajo → subtareas,
 * checklists, dependencias y tiempo; soporte → tiempo; personas → aviso de
 * duplicados; el resto, la base.
 */
export function suggestListFeatures(input: { name: string; fields: readonly SuggestLayoutField[] }): ListFeatures {
    const kind = suggestRecordLayoutTemplate(input);
    if (kind === 'task') return listFeaturesWith('subtasks', 'checklists', 'dependencies', 'time_tracking');
    if (kind === 'support') return listFeaturesWith('time_tracking');
    if (kind === 'contact') return listFeaturesWith('duplicates');
    return { ...LIST_FEATURES_BASE };
}

/** Cuántas están encendidas (el resumen del menú: «4 de 7»). */
export function countListFeatures(features: ListFeatures): number {
    return LIST_FEATURE_KEYS.filter((k) => features[k]).length;
}
