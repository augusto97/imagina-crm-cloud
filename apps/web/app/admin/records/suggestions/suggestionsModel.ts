import type { ListSuggestion, ListSuggestionCategory, ListSuggestionsResponse } from '@imagina-base/shared';

import type { IdeaDef } from '@/admin/ideas/types';

/**
 * v0.1.341 (ADR-S89) — Lo que arma la pantalla de sugerencias a partir de la
 * respuesta del servidor: le suma las IDEAS del catálogo que encajan con la
 * lista (viven en el front) con su estado recordado en el servidor, y cuenta
 * lo nuevo para el aviso de la cabecera. Puro.
 */

/** Hasta cuántas ideas del catálogo se mezclan con las reglas. */
export const MAX_IDEAS = 2;

export function ideaKey(ideaId: string): string {
    return `idea.${ideaId}`.toLowerCase().replace(/[^a-z0-9_.:-]/g, '-').slice(0, 120);
}

/** Las ideas del catálogo como sugerencias (enlace a «Ver y activar»). */
export function ideaSuggestions(ideas: readonly IdeaDef[], listSlug: string, marks: Record<string, 'applied' | 'dismissed'>): ListSuggestion[] {
    return ideas.slice(0, MAX_IDEAS).map((idea) => {
        const key = ideaKey(idea.id);
        const mark = marks[key];
        return {
            key,
            source: 'rules',
            category: 'automation',
            title: idea.title,
            why: idea.summary,
            action: { type: 'link', label: 'Ver y activar', href: `/ideas/${idea.id}?lista=${encodeURIComponent(listSlug)}` },
            preview: null,
            status: mark === 'dismissed' ? 'dismissed' : mark === 'applied' ? 'applied' : 'new',
            applied: null,
        };
    });
}

export interface SuggestionsSplit {
    rules: ListSuggestion[];
    ai: ListSuggestion[];
    dismissed: ListSuggestion[];
    applied: ListSuggestion[];
    newCount: number;
}

/** Separa lo nuevo (por capa), lo descartado y lo aplicado; cuenta lo nuevo. */
export function splitSuggestions(res: Pick<ListSuggestionsResponse, 'suggestions'>, ideas: ListSuggestion[] = []): SuggestionsSplit {
    const all = [...res.suggestions.filter((s) => s.source === 'rules'), ...ideas, ...res.suggestions.filter((s) => s.source === 'ai')];
    const rules = all.filter((s) => s.source === 'rules' && s.status === 'new');
    const ai = all.filter((s) => s.source === 'ai' && s.status === 'new');
    return {
        rules,
        ai,
        dismissed: all.filter((s) => s.status === 'dismissed'),
        applied: all.filter((s) => s.status === 'applied'),
        newCount: rules.length + ai.length,
    };
}

/** Ícono y color de cada clase de sugerencia (los del manual). */
export const CATEGORY_LOOK: Record<ListSuggestionCategory, { icon: string; tone: string; label: string }> = {
    view: { icon: 'KanbanSquare', tone: 'blue', label: 'Vista' },
    dashboard: { icon: 'LayoutDashboard', tone: 'violet', label: 'Tablero' },
    automation: { icon: 'Zap', tone: 'amber', label: 'Automatización' },
    field: { icon: 'Type', tone: 'cyan', label: 'Campo' },
    quality: { icon: 'ShieldCheck', tone: 'rose', label: 'Calidad de los datos' },
    share: { icon: 'FormInput', tone: 'mint', label: 'Compartir' },
};

/** El texto del paso de la IA en curso. */
export function aiStageText(stage: 'reading' | 'thinking' | 'checking' | null): string {
    if (stage === 'checking') return 'Revisando que cada sugerencia se pueda aplicar…';
    if (stage === 'reading') return 'Leyendo cómo está armada tu lista…';
    return 'Pensando qué le sirve a esta lista…';
}
