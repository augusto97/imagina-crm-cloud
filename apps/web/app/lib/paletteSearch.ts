import { foldText } from '@/lib/folderSections';

/**
 * v0.1.286 — coincidencia de la paleta (Ctrl+K): sin mayúsculas ni acentos
 * ("nomina" encuentra «Nómina») y por PALABRAS en cualquier orden ("fact
 * pend" encuentra «Facturas pendientes»).
 */
export function paletteMatches(haystack: string, query: string): boolean {
    const tokens = foldText(query).split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return true;
    const text = foldText(haystack);
    return tokens.every((t) => text.includes(t));
}

/**
 * Puntaje para ordenar: el nombre que EMPIEZA con lo buscado gana, después
 * una palabra que empieza, después cualquier coincidencia. Menor = mejor.
 */
export function paletteRank(label: string, query: string): number {
    const q = foldText(query.trim());
    if (q === '') return 0;
    const l = foldText(label);
    if (l.startsWith(q)) return 0;
    if (l.split(/[\s\-_/·]+/).some((w) => w.startsWith(q))) return 1;
    return 2;
}
