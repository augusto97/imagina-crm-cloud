import { z } from 'zod';
import { aiProposalPreviewSchema } from '../schemas/ai';

/**
 * v0.1.341 (ADR-S89) — Sugerencias POR LISTA: lo que conviene agregarle a la
 * lista que la persona tiene abierta (vistas, un tablero, automatizaciones,
 * ajustes de campos, un formulario), basado en SUS campos y SUS datos.
 *
 * Dos capas: REGLAS (gratis, se calculan al abrir el panel, sobre una muestra
 * de los registros) e IA A PEDIDO (un botón; una vez, con cache por huella de
 * la lista y un cupo propio por empresa y mes). Nada se crea solo: cada
 * sugerencia se aplica o se descarta con un clic.
 */

/** Qué sugerencias ve la empresa: reglas e IA, sólo reglas, o ninguna. */
export const LIST_SUGGESTION_MODES = ['all', 'rules', 'off'] as const;
export const listSuggestionModeSchema = z.enum(LIST_SUGGESTION_MODES);
export type ListSuggestionMode = z.infer<typeof listSuggestionModeSchema>;
export const DEFAULT_LIST_SUGGESTION_MODE: ListSuggestionMode = 'all';

export const LIST_SUGGESTION_CATEGORIES = ['view', 'dashboard', 'automation', 'field', 'quality', 'share'] as const;
export const listSuggestionCategorySchema = z.enum(LIST_SUGGESTION_CATEGORIES);
export type ListSuggestionCategory = z.infer<typeof listSuggestionCategorySchema>;

/** Cupo de análisis con IA por empresa y mes con la clave de la plataforma (Plataforma → Asistente IA). */
export const DEFAULT_LIST_SUGGEST_AI_MONTHLY = 5;
/** Una lista ya analizada se puede volver a analizar si cambió o pasaron estos días. */
export const LIST_SUGGESTIONS_REANALYZE_DAYS = 30;
/** Con menos registros que esto, el panel pregunta para qué se usa la lista (la IA no adivina). */
export const LIST_SUGGESTIONS_PURPOSE_BELOW = 10;
/** Tope de sugerencias de la IA por análisis. */
export const LIST_SUGGESTIONS_AI_MAX = 6;

/** Una clave de sugerencia: reglas (`view.kanban.f12`), IA (`ai.…`) o ideas del catálogo (`idea.…`). */
export const listSuggestionKeySchema = z.string().regex(/^[a-z][a-z0-9_.:-]{1,119}$/);

export const listSuggestionActionSchema = z.discriminatedUnion('type', [
    /** La aplica el servidor (crea la vista, el tablero, la automatización…). */
    z.object({ type: z.literal('apply'), label: z.string() }),
    /** Lleva a una pantalla (configurar un formulario, ver los repetidos…). */
    z.object({ type: z.literal('link'), label: z.string(), href: z.string() }),
]);
export type ListSuggestionAction = z.infer<typeof listSuggestionActionSchema>;

export const listSuggestionAppliedSchema = z.object({
    at: z.string(),
    message: z.string(),
    links: z.array(z.object({ label: z.string(), href: z.string() })).default([]),
});

export const listSuggestionSchema = z.object({
    key: listSuggestionKeySchema,
    source: z.enum(['rules', 'ai']),
    category: listSuggestionCategorySchema,
    title: z.string(),
    /** Por qué: la evidencia en los datos de la lista («El 30 % está vencido»). */
    why: z.string(),
    action: listSuggestionActionSchema,
    /** Vista previa (la misma de las propuestas del asistente), si aplica. */
    preview: aiProposalPreviewSchema.nullable().default(null),
    status: z.enum(['new', 'applied', 'dismissed']).default('new'),
    applied: listSuggestionAppliedSchema.nullable().default(null),
});
export type ListSuggestion = z.infer<typeof listSuggestionSchema>;

export const LIST_SUGGESTION_AI_STAGES = ['reading', 'thinking', 'checking'] as const;

export const listSuggestionsAiStateSchema = z.object({
    /** El botón se puede usar ahora (y, si no, por qué). */
    available: z.boolean(),
    reason: z.string().nullable(),
    /** Análisis que le quedan a la empresa este mes (null = sin tope: clave propia). */
    remaining: z.number().int().nullable(),
    limit: z.number().int().nullable(),
    state: z.enum(['idle', 'running', 'done', 'error']),
    stage: z.enum(LIST_SUGGESTION_AI_STAGES).nullable(),
    error: z.string().nullable(),
    analyzed_at: z.string().nullable(),
    /** Se puede volver a analizar (la lista cambió o pasó el plazo). */
    can_reanalyze: z.boolean(),
    reanalyze_hint: z.string().nullable(),
    purpose: z.string().nullable(),
    /** El último análisis incluyó ejemplos de texto (enmascarados). */
    with_examples: z.boolean().default(false),
    /** Pocos registros: conviene contar para qué se usa la lista. */
    ask_purpose: z.boolean(),
});
export type ListSuggestionsAiState = z.infer<typeof listSuggestionsAiStateSchema>;

export const listSuggestionsResponseSchema = z.object({
    /** Esta persona ve sugerencias en esta lista (rol, modo de la empresa). */
    enabled: z.boolean(),
    mode: listSuggestionModeSchema,
    /** La persona ocultó el aviso de la cabecera (el panel se sigue pudiendo abrir). */
    hidden_for_me: z.boolean(),
    /** Puede cambiar el modo de la empresa (admin). */
    can_configure: z.boolean(),
    /** Cuántas sugerencias nuevas (sin aplicar ni descartar). */
    new_count: z.number().int().nonnegative(),
    suggestions: z.array(listSuggestionSchema),
    /** Lo aplicado y descartado de la lista, por clave (también las ideas del catálogo, que arma la pantalla). */
    marks: z.record(z.enum(['applied', 'dismissed'])).default({}),
    ai: listSuggestionsAiStateSchema,
    /** Sobre cuántos registros se calculó (los más recientes, hasta un tope). */
    sample: z.object({ total: z.number().int().nonnegative(), sampled: z.number().int().nonnegative() }),
});
export type ListSuggestionsResponse = z.infer<typeof listSuggestionsResponseSchema>;

export const runListSuggestionsAiSchema = z.object({
    purpose: z.string().trim().max(500).optional(),
    /**
     * «Incluir ejemplos de texto»: hasta 5 ejemplos por campo de texto, con
     * correos, enlaces, números largos y nombres propios tapados. Apagado por
     * defecto: sin la casilla, a la IA sólo le llegan estructura y números.
     */
    include_examples: z.boolean().optional(),
    /** Consentimiento en línea: se manda un resumen de la lista al proveedor de IA. */
    consent: z.literal(true),
});
export type RunListSuggestionsAiInput = z.infer<typeof runListSuggestionsAiSchema>;

export const listSuggestionsSettingsSchema = z.object({
    mode: listSuggestionModeSchema,
    hidden_for_me: z.boolean(),
    can_configure: z.boolean(),
    ai_monthly: z.number().int().nullable(),
});
export type ListSuggestionsSettings = z.infer<typeof listSuggestionsSettingsSchema>;

export const updateListSuggestionsSettingsSchema = z
    .object({
        mode: listSuggestionModeSchema.optional(),
        hidden_for_me: z.boolean().optional(),
    })
    .refine((v) => v.mode !== undefined || v.hidden_for_me !== undefined, { message: 'Nada que cambiar' });
export type UpdateListSuggestionsSettingsInput = z.infer<typeof updateListSuggestionsSettingsSchema>;

export const applyListSuggestionResultSchema = z.object({
    suggestion: listSuggestionSchema,
    warnings: z.array(z.string()).default([]),
});
export type ApplyListSuggestionResult = z.infer<typeof applyListSuggestionResultSchema>;
