import { FormulaSyntaxError, escapeRefName, positionText, tokenize, type Token } from './lexer';

/**
 * Fórmulas — referencias a campos.
 *
 * Se ESCRIBEN por nombre (`{Precio}`; también sirve el nombre interno, el
 * slug) y se GUARDAN por id (`{#12}`): renombrar un campo no rompe nada
 * (regla de oro nº 1). Todas las conversiones trabajan sobre los tokens y
 * reemplazan SÓLO el texto de cada referencia, así lo demás (espacios, saltos
 * de línea, mayúsculas de las funciones) queda como lo escribió la persona.
 */

export interface FormulaFieldRef {
    id: number;
    slug: string;
    label: string;
    type: string;
}

/** `#12` → 12; cualquier otra cosa → null. */
export function storedRefId(name: string): number | null {
    const m = /^#(\d{1,15})$/.exec(name.trim());
    if (!m) return null;
    const id = Number(m[1]);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** Normaliza un nombre para compararlo: sin tildes, minúsculas y espacios simples. */
export function normalizeRefName(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

export interface FormulaIssue {
    message: string;
    start: number;
    end: number;
}

type RefLookup = { ok: true; field: FormulaFieldRef } | { ok: false; message: string };

/**
 * Busca el campo de una referencia escrita por una persona: `#id`, el nombre
 * (sin distinguir mayúsculas ni tildes) o el nombre interno. Si dos campos
 * se llaman igual, pide el nombre interno para desempatar.
 */
export function lookupRef(name: string, fields: readonly FormulaFieldRef[]): RefLookup {
    const byId = storedRefId(name);
    if (byId !== null) {
        const f = fields.find((x) => x.id === byId);
        return f ? { ok: true, field: f } : { ok: false, message: `El campo #${byId} no existe en esta lista.` };
    }
    // `{@slug}`: por nombre interno EXACTO (lo usan las plantillas, donde el
    // id cambia y un nombre podría repetirse).
    if (name.trim().startsWith('@')) {
        const slug = name.trim().slice(1);
        const f = fields.find((x) => x.slug === slug);
        return f ? { ok: true, field: f } : { ok: false, message: `No hay ningún campo con el nombre interno «${slug}» en esta lista.` };
    }
    const wanted = normalizeRefName(name);
    const byLabel = fields.filter((f) => normalizeRefName(f.label) === wanted);
    if (byLabel.length === 1) return { ok: true, field: byLabel[0]! };
    const exactSlug = fields.find((f) => f.slug === name.trim());
    if (exactSlug) return { ok: true, field: exactSlug };
    if (byLabel.length > 1) {
        return {
            ok: false,
            message: `Hay ${byLabel.length} campos que se llaman «${name}»: escribe su nombre interno (${byLabel.map((f) => `{${f.slug}}`).join(' o ')}).`,
        };
    }
    const bySlug = fields.find((f) => f.slug === wanted);
    if (bySlug) return { ok: true, field: bySlug };
    return { ok: false, message: `No hay ningún campo «${name}» en esta lista.` };
}

/** Las referencias de un texto con su posición (o el error de sintaxis). */
function refTokens(text: string): Token[] {
    return tokenize(text).filter((t) => t.kind === 'ref');
}

function replaceRefs(text: string, tokens: Token[], render: (t: Token) => string): string {
    let out = '';
    let last = 0;
    for (const t of tokens) {
        out += text.slice(last, t.start) + render(t);
        last = t.end;
    }
    return out + text.slice(last);
}

export type ToStoredResult =
    | { ok: true; stored: string; refs: number[] }
    | { ok: false; error: FormulaIssue };

/**
 * Texto que escribió una persona (por nombre, o mezclado con `{#id}`) → la
 * forma GUARDADA (`{#id}`). Valida que cada referencia exista y que la
 * fórmula no se use a sí misma; no valida la sintaxis del resto (eso lo hace
 * `parseFormula`).
 */
export function formulaToStored(
    text: string,
    fields: readonly FormulaFieldRef[],
    opts: { selfId?: number | null } = {},
): ToStoredResult {
    let tokens: Token[];
    try {
        tokens = refTokens(text);
    } catch (e) {
        if (e instanceof FormulaSyntaxError) return { ok: false, error: { message: e.message, start: e.start, end: e.end } };
        throw e;
    }
    const refs: number[] = [];
    for (const t of tokens) {
        const hit = lookupRef(t.value, fields);
        if (!hit.ok) {
            return { ok: false, error: { message: `${hit.message} (${positionText(text, t.start)})`, start: t.start, end: t.end } };
        }
        if (opts.selfId !== undefined && opts.selfId !== null && hit.field.id === opts.selfId) {
            return {
                ok: false,
                error: { message: `Una fórmula no puede usarse a sí misma (${positionText(text, t.start)}).`, start: t.start, end: t.end },
            };
        }
        if (!refs.includes(hit.field.id)) refs.push(hit.field.id);
    }
    const byStart = new Map(tokens.map((t) => [t.start, lookupRef(t.value, fields)]));
    const stored = replaceRefs(text, tokens, (t) => {
        const hit = byStart.get(t.start);
        return hit && hit.ok ? `{#${hit.field.id}}` : text.slice(t.start, t.end);
    });
    return { ok: true, stored, refs };
}

/**
 * Cómo se ESCRIBE la referencia a un campo: su nombre, o su nombre interno
 * cuando el nombre se repite en la lista (o parece una referencia por id).
 */
export function refDisplayName(field: FormulaFieldRef, fields: readonly FormulaFieldRef[]): string {
    const norm = normalizeRefName(field.label);
    const clash = fields.some((f) => f.id !== field.id && (normalizeRefName(f.label) === norm || f.slug === norm));
    if (clash || storedRefId(field.label) !== null) return field.slug;
    return field.label;
}

/**
 * Forma guardada → texto para MOSTRAR (por nombre). Un campo que ya no está
 * (en la papelera) se muestra con el último nombre conocido (`labels`) o como
 * `{#id}`.
 */
export function formulaToDisplay(
    stored: string,
    fields: readonly FormulaFieldRef[],
    labels: Readonly<Record<string, string>> = {},
): string {
    const render = (id: number | null, raw: string): string => {
        if (id === null) return `{${escapeRefName(raw)}}`;
        const f = fields.find((x) => x.id === id);
        if (f) return `{${escapeRefName(refDisplayName(f, fields))}}`;
        const known = labels[String(id)];
        return known ? `{${escapeRefName(known)}}` : `{#${id}}`;
    };
    try {
        const tokens = refTokens(stored);
        return replaceRefs(stored, tokens, (t) => render(storedRefId(t.value), t.value));
    } catch {
        // Una fórmula guardada siempre se puede leer; por las dudas, el
        // reemplazo directo de `{#id}`.
        return stored.replace(/\{#(\d+)\}/g, (_m, id: string) => render(Number(id), `#${id}`));
    }
}

/** Ids de los campos que usa una fórmula guardada (sin repetir). */
export function formulaRefIds(stored: string): number[] {
    const out: number[] = [];
    try {
        for (const t of refTokens(stored)) {
            const id = storedRefId(t.value);
            if (id !== null && !out.includes(id)) out.push(id);
        }
    } catch {
        for (const m of stored.matchAll(/\{#(\d+)\}/g)) {
            const id = Number(m[1]);
            if (!out.includes(id)) out.push(id);
        }
    }
    return out;
}

/**
 * Plantillas / duplicar una lista: `{#id}` → `{@slug}` (el id cambia al crear
 * la copia; el nombre interno no). Al materializar, guardar la fórmula la
 * vuelve a traducir a ids. Un id desconocido queda como `{#0}`.
 */
export function formulaRefsToSlugs(stored: string, slugOf: (id: number) => string | undefined): string {
    return remapText(stored, (raw) => {
        const id = storedRefId(raw);
        if (id === null) return `{${escapeRefName(raw)}}`;
        const slug = slugOf(id);
        return slug ? `{@${escapeRefName(slug)}}` : '{#0}';
    });
}

/**
 * Migrar una empresa: la config de un campo fórmula con los ids NUEVOS (en
 * el texto y en los nombres recordados).
 */
export function remapFormulaConfig(config: Record<string, unknown>, map: (id: number) => number | null | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = { ...config };
    if (typeof config.formula === 'string') out.formula = remapFormulaRefs(config.formula, map);
    if (config.labels && typeof config.labels === 'object') {
        const labels: Record<string, string> = {};
        for (const [k, v] of Object.entries(config.labels as Record<string, unknown>)) {
            const next = map(Number(k));
            if (next && typeof v === 'string') labels[String(next)] = v;
        }
        out.labels = labels;
    }
    return out;
}

function remapText(stored: string, render: (raw: string) => string): string {
    try {
        const tokens = refTokens(stored);
        return replaceRefs(stored, tokens, (t) => render(t.value));
    } catch {
        return stored.replace(/\{#(\d+)\}/g, (_m, id: string) => render(`#${id}`));
    }
}

/**
 * Cambia los ids de las referencias (plantillas, duplicar una lista, migrar
 * una empresa). `map` devuelve el id nuevo, o null si el campo no viajó: esa
 * referencia queda como `{#0}` y la fórmula avisa que el campo no existe.
 */
export function remapFormulaRefs(stored: string, map: (id: number) => number | null | undefined): string {
    const render = (raw: string): string => {
        const id = storedRefId(raw);
        if (id === null) return `{${escapeRefName(raw)}}`;
        const next = map(id);
        return `{#${next ?? 0}}`;
    };
    try {
        const tokens = refTokens(stored);
        return replaceRefs(stored, tokens, (t) => render(t.value));
    } catch {
        return stored.replace(/\{#(\d+)\}/g, (_m, id: string) => render(`#${id}`));
    }
}
