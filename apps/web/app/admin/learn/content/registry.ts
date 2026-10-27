import { fold, LEARN_GROUPS, type LearnArticle, type LearnArticleMeta, type LearnModuleMeta } from './types';

/**
 * Índice del manual: los `*.meta.ts` se cargan con el centro (son livianos) y
 * los `*.content.ts` se bajan al abrir cada módulo. El nombre del archivo es
 * el id del módulo (`modules/vistas.meta.ts` → `vistas`).
 */
const metaFiles = import.meta.glob<{ meta: LearnModuleMeta }>('./modules/*.meta.ts', { eager: true });
const contentFiles = import.meta.glob<{ articles: LearnArticle[] }>('./modules/*.content.ts');

const idOf = (path: string, suffix: string): string => path.replace(/^\.\/modules\//, '').replace(suffix, '');

export const LEARN_MODULES: readonly LearnModuleMeta[] = Object.entries(metaFiles)
    .map(([path, mod]) => {
        const m = mod.meta;
        if (m.id !== idOf(path, '.meta.ts')) throw new Error(`El módulo ${path} declara id «${m.id}»`);
        return m;
    })
    .sort((a, b) => {
        const ga = LEARN_GROUPS.findIndex((g) => g.id === a.group);
        const gb = LEARN_GROUPS.findIndex((g) => g.id === b.group);
        return ga - gb || a.order - b.order;
    });

const loaders = new Map(Object.entries(contentFiles).map(([path, load]) => [idOf(path, '.content.ts'), load]));

export function moduleById(id: string): LearnModuleMeta | undefined {
    return LEARN_MODULES.find((m) => m.id === id);
}

export function findArticle(articleId: string): { module: LearnModuleMeta; article: LearnArticleMeta } | null {
    for (const module of LEARN_MODULES) {
        const article = module.articles.find((a) => a.id === articleId);
        if (article) return { module, article };
    }
    return null;
}

const cache = new Map<string, Promise<LearnArticle[]>>();

/** Los artículos completos de un módulo (una sola bajada por sesión). */
export function loadModuleContent(moduleId: string): Promise<LearnArticle[]> {
    let p = cache.get(moduleId);
    if (!p) {
        const load = loaders.get(moduleId);
        p = load ? load().then((m) => m.articles) : Promise.resolve([]);
        cache.set(moduleId, p);
    }
    return p;
}

/** Todo el manual (para buscar dentro del texto). */
export function loadAllContent(): Promise<Map<string, LearnArticle>> {
    return Promise.all(LEARN_MODULES.map((m) => loadModuleContent(m.id))).then((all) => {
        const map = new Map<string, LearnArticle>();
        for (const list of all) for (const a of list) map.set(a.id, a);
        return map;
    });
}

/** Texto plano de un artículo, para buscar. */
export function articleText(a: LearnArticle): string {
    const parts: string[] = [];
    for (const b of a.blocks) {
        switch (b.t) {
            case 'p':
            case 'callout':
                parts.push(b.md);
                break;
            case 'h':
                parts.push(b.text);
                break;
            case 'steps':
                parts.push(...b.items);
                break;
            case 'settings':
                for (const r of b.rows) parts.push(r.name, r.what, r.tip ?? '');
                break;
            case 'example':
                parts.push(b.title, b.md);
                break;
            case 'cards':
                for (const c of b.items) parts.push(c.title, c.md);
                break;
            case 'faq':
                for (const f of b.items) parts.push(f.q, f.a);
                break;
            case 'keys':
                for (const k of b.items) parts.push(k.what);
                break;
            default:
                break;
        }
    }
    return parts.join(' \n ');
}

export interface LearnHit {
    module: LearnModuleMeta;
    article: LearnArticleMeta;
    /** Fragmento del texto donde apareció (si fue en el cuerpo). */
    snippet?: string;
    score: number;
}

/**
 * Busca en títulos, resúmenes y palabras clave (siempre) y en el texto
 * completo (si ya se bajó). Todas las palabras tienen que aparecer.
 */
export function searchManual(query: string, bodies: Map<string, LearnArticle> | null, canSee: (m: LearnModuleMeta, a: LearnArticleMeta) => boolean): LearnHit[] {
    const words = fold(query).split(/\s+/).filter((w) => w.length > 1);
    if (words.length === 0) return [];
    const hits: LearnHit[] = [];
    for (const module of LEARN_MODULES) {
        for (const article of module.articles) {
            if (!canSee(module, article)) continue;
            const head = fold(`${article.title} ${article.summary} ${article.keywords ?? ''} ${module.title}`);
            const body = bodies?.get(article.id);
            const bodyText = body ? fold(articleText(body)) : '';
            let score = 0;
            let ok = true;
            for (const w of words) {
                const stem = w.length > 4 ? w.slice(0, -1) : w;
                if (fold(article.title).includes(stem)) score += 6;
                else if (head.includes(stem)) score += 3;
                else if (bodyText.includes(stem)) score += 1;
                else {
                    ok = false;
                    break;
                }
            }
            if (!ok) continue;
            let snippet: string | undefined;
            if (body && !head.includes(words[0]!)) {
                const raw = articleText(body).replace(/\*\*|\[|\]\([^)]*\)/g, '');
                const at = fold(raw).indexOf(words[0]!.length > 4 ? words[0]!.slice(0, -1) : words[0]!);
                if (at >= 0) snippet = `${at > 40 ? '…' : ''}${raw.slice(Math.max(0, at - 40), at + 90).replace(/\s+/g, ' ').trim()}…`;
            }
            hits.push({ module, article, snippet, score });
        }
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, 30);
}
