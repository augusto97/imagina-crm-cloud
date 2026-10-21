/**
 * Búsqueda de registros — UNA definición para el navegador y el servidor.
 *
 * Antes la búsqueda in-memory (listas chicas) plegaba acentos y separaba por
 * palabras, mientras el servidor hacía un único `ILIKE '%texto%'` sensible a
 * los acentos: `alvaro` daba 0 resultados en una lista grande y 6 en una
 * chica. Ahora las dos puntas:
 *  - pliegan el texto (minúsculas, sin acentos: «Álvaro» → «alvaro»);
 *  - parten la búsqueda en palabras y exigen TODAS (AND), cada una en
 *    cualquier campo buscable del registro.
 */

/** Tipos cuyo texto entra en la búsqueda de registros. */
export const SEARCHABLE_FIELD_TYPES: ReadonlySet<string> = new Set([
    'text',
    'long_text',
    'email',
    'url',
    'phone',
    'ai',
]);

/** Tope de palabras por búsqueda (cada una es un patrón por fila). */
const MAX_TOKENS = 8;
/** Tope de largo de una palabra. */
const MAX_TOKEN_LENGTH = 64;

/** Minúsculas y sin acentos (descomposición NFD + quitar las marcas). */
export function foldSearchText(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * Palabras de una búsqueda, ya plegadas: se separa por todo lo que no sea
 * letra, número o `_` (así «foo@bar.com» busca foo, bar y com, y
 * «(300) 111-2233» busca 300, 111 y 2233).
 */
export function searchTokens(query: string): string[] {
    const out: string[] = [];
    for (const raw of foldSearchText(query).split(/[^\p{L}\p{N}_]+/u)) {
        if (raw === '') continue;
        const token = raw.slice(0, MAX_TOKEN_LENGTH);
        if (!out.includes(token)) out.push(token);
        if (out.length >= MAX_TOKENS) break;
    }
    return out;
}

/** Variantes con acento de cada letra base (en minúscula). */
const ACCENTED = 'àáâãäåāăąèéêëēĕėęěìíîïĩīĭįòóôõöōŏőùúûüũūŭůűųñńňçćčýÿśšźžżďťľĺŕř';
const VARIANTS: Map<string, string[]> = (() => {
    const map = new Map<string, string[]>();
    for (const ch of ACCENTED) {
        const base = foldSearchText(ch);
        if (base.length !== 1 || base === ch) continue;
        const list = map.get(base) ?? [];
        list.push(ch, ch.toUpperCase());
        map.set(base, list);
    }
    return map;
})();

/**
 * Patrón de expresión regular (sintaxis de Postgres) que encuentra una palabra
 * YA PLEGADA en un texto sin plegar: cada letra se vuelve una clase con su
 * mayúscula y sus variantes acentuadas (`a` → `[aAáÁàÀ…]`). Se compara con `~`
 * (sensible a mayúsculas) a propósito: así no depende de cómo pliega el
 * locale de la base, y no hay que transformar el texto de cada fila — es lo
 * que lo mantiene rápido (≈ un ILIKE) sobre listas de 100k registros.
 *
 * La palabra sólo trae letras, números y `_` (ver `searchTokens`), así que no
 * hay metacaracteres que escapar fuera de las clases.
 */
export function searchTokenPattern(token: string): string {
    let out = '';
    for (const ch of token) {
        const lower = ch.toLowerCase();
        const upper = ch.toUpperCase();
        const set = [...new Set([lower, ...(upper.length === 1 ? [upper] : []), ...(VARIANTS.get(lower) ?? [])])];
        if (set.length > 1) out += `[${set.join('')}]`;
        else out += /[\p{L}\p{N}_]/u.test(ch) ? ch : `\\${ch}`;
    }
    return out;
}

/** Sólo los dígitos de una palabra con dígitos (para comparar teléfonos). */
export function searchTokenDigits(token: string): string {
    return token.replace(/\D+/g, '');
}

/**
 * ¿El texto (ya juntado y plegado) contiene todas las palabras? Lo usa la
 * búsqueda in-memory; el servidor hace lo mismo con `searchTokenPattern`.
 */
export function matchesSearchTokens(foldedBlob: string, tokens: readonly string[]): boolean {
    return tokens.every((t) => foldedBlob.includes(t));
}
