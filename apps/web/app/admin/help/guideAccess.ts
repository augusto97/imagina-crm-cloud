import {
    customGuideToHelpGuide,
    HELP_CATEGORIES,
    helpVideoEmbed,
    type Capability,
    type HelpConfigView,
    type HelpGuide,
} from '@imagina-base/shared';

import { foldText } from '@/lib/folderSections';

/**
 * Fase 7 — qué guías ve cada persona y cómo se buscan. Puro: lo prueban los
 * tests y lo comparten el panel de Ayuda y la búsqueda global (Ctrl+K).
 */

export interface GuideViewer {
    role: string | null;
    isAdmin: boolean;
    caps: ReadonlySet<Capability>;
}

/** Una guía con lo que esta persona puede hacer con ella. */
export interface VisibleGuide {
    guide: HelpGuide;
    /** No le toca a su rol: se muestra con «Lo hace un administrador». */
    restricted: boolean;
    /** El video que la acompaña (`src` del iframe), si hay. */
    videoSrc: string | null;
}

function canDo(g: HelpGuide, v: GuideViewer): boolean {
    if (g.admin_only && !v.isAdmin) return false;
    if (g.requires && g.requires.length > 0 && !g.requires.some((c) => v.caps.has(c))) return false;
    return true;
}

/**
 * Las del sistema (menos las que el operador ocultó) + las propias del
 * operador (que el servidor ya filtró por rol), con el video de cada una.
 */
export function visibleGuides(system: readonly HelpGuide[], config: HelpConfigView, viewer: GuideViewer): VisibleGuide[] {
    const hidden = new Set(config.hidden);
    const out: VisibleGuide[] = [];
    for (const g of system) {
        if (hidden.has(g.id)) continue;
        const allowed = canDo(g, viewer);
        if (!allowed && (g.if_restricted ?? 'hide') === 'hide') continue;
        const video = config.videos[g.id];
        out.push({ guide: g, restricted: !allowed, videoSrc: video ? helpVideoEmbed(video) : null });
    }
    for (const c of config.custom) {
        // Defensa extra: el servidor ya filtró por rol.
        if (c.roles.length > 0 && (viewer.role === null || !(c.roles as string[]).includes(viewer.role))) continue;
        const g = customGuideToHelpGuide(c);
        out.push({ guide: g, restricted: false, videoSrc: c.video_url ? helpVideoEmbed(c.video_url) : null });
    }
    return out;
}

/**
 * Raíz aproximada de una palabra: «importo», «importar» e «importación»
 * tienen que encontrarse entre sí. Se quita una terminación común (verbos y
 * plurales) y quedan al menos 3 letras.
 */
export function stem(word: string): string {
    if (word.length < 4) return word;
    const cut = word.replace(/(aciones|acion|ciones|cion|ar|er|ir|as|es|os|o|a|e)$/, '');
    return cut.length >= 3 ? cut : word;
}

/** Puntaje de búsqueda: menor = mejor. `null` = no coincide. */
export function guideScore(g: HelpGuide, query: string): number | null {
    const tokens = foldText(query)
        .split(/[\s,.;:¿?¡!«»"()]+/)
        .filter((t) => t.length > 0)
        // Palabras vacías: «cómo», «hago», «un»… no ayudan a distinguir.
        .filter((t) => !STOP.has(t))
        .map(stem);
    if (tokens.length === 0) return foldText(query).trim() === '' ? 0 : null;
    const title = foldText(g.title);
    const keywords = foldText(g.keywords ?? '');
    const body = foldText(`${g.body} ${g.tip ?? ''}`);
    const all = `${title} ${keywords} ${body}`;
    if (!tokens.every((t) => all.includes(t))) return null;
    let score = 0;
    for (const t of tokens) {
        if (title.includes(t)) score += 0;
        else if (keywords.includes(t)) score += 1;
        else score += 3;
    }
    return score;
}

const STOP = new Set(['como', 'hago', 'hacer', 'un', 'una', 'el', 'la', 'los', 'las', 'de', 'del', 'a', 'en', 'y', 'o', 'que', 'mi', 'mis', 'se', 'para', 'con', 'por', 'puedo', 'al', 'lo']);

export function searchGuides(list: readonly VisibleGuide[], query: string, limit = 50): VisibleGuide[] {
    const scored: Array<{ v: VisibleGuide; s: number; i: number }> = [];
    list.forEach((v, i) => {
        const s = guideScore(v.guide, query);
        if (s !== null) scored.push({ v, s, i });
    });
    scored.sort((a, b) => a.s - b.s || a.i - b.i);
    return scored.slice(0, limit).map((x) => x.v);
}

/**
 * Las guías de la pantalla en que está la persona. Primero las de la sección
 * puntual (`settings:miembros`), después las de la pantalla (`settings`).
 */
export function guidesForScreens(list: readonly VisibleGuide[], screens: readonly string[], limit = 5): VisibleGuide[] {
    if (screens.length === 0) return [];
    const specific = screens.filter((s) => s.includes(':'));
    const general = screens.filter((s) => !s.includes(':'));
    const rank = (v: VisibleGuide): number => {
        if (v.guide.screens.some((s) => specific.includes(s))) return 0;
        if (v.guide.screens.some((s) => general.includes(s))) return 1;
        return -1;
    };
    return list
        .map((v, i) => ({ v, r: rank(v), i }))
        .filter((x) => x.r >= 0)
        // Las propias del operador primero (las puso para ESTA pantalla), y
        // las que la persona puede hacer antes que las de «lo hace un admin».
        .sort(
            (a, b) =>
                a.r - b.r ||
                Number(b.v.guide.source === 'custom') - Number(a.v.guide.source === 'custom') ||
                Number(a.v.restricted) - Number(b.v.restricted) ||
                a.i - b.i,
        )
        .slice(0, limit)
        .map((x) => x.v);
}

export function byCategory(list: readonly VisibleGuide[]): Array<{ id: string; label: string; guides: VisibleGuide[] }> {
    return HELP_CATEGORIES.map((c) => ({ id: c.id, label: c.label, guides: list.filter((v) => v.guide.category === c.id) })).filter(
        (c) => c.guides.length > 0,
    );
}

/** «Ir ahí»: `{list}` = una lista que la persona ve (sin ninguna, el índice de listas). */
export function resolveGuideRoute(route: string, firstListSlug: string | null): string {
    if (!route.includes('{list}')) return route;
    return firstListSlug ? route.replace(/\{list\}/g, encodeURIComponent(firstListSlug)) : '/lists';
}

/** `{app}` en el texto de una guía → el nombre de la app (white-label) o «la app». */
export function fillGuideText(text: string, appName: string): string {
    return text.replace(/\{app\}/g, appName);
}
