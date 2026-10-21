/**
 * Búsqueda de registros — UNA definición para el navegador y el servidor.
 *
 * Antes la búsqueda in-memory (listas chicas) plegaba acentos y separaba por
 * palabras, mientras el servidor hacía un único `ILIKE '%texto%'` sensible a
 * los acentos: `alvaro` daba 0 resultados en una lista grande y 6 en una
 * chica. Ahora las dos puntas:
 *  - pliegan el texto (minúsculas, sin acentos: «Álvaro» → «alvaro»);
 *  - parten la búsqueda en palabras (por los ESPACIOS: «N-001» o
 *    «ana@acme.co» siguen siendo una sola palabra) y exigen TODAS (AND), cada
 *    una en cualquier campo buscable del registro;
 *  - una palabra con dígitos y signos («300-111-2233», «(300)») también se
 *    busca SÓLO CON SUS DÍGITOS, que es como se comparan los teléfonos.
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

/** Palabras de una búsqueda, ya plegadas, separadas por espacios (sin repetir). */
export function searchTokens(query: string): string[] {
    const out: string[] = [];
    for (const raw of foldSearchText(query).split(/\s+/u)) {
        if (raw === '') continue;
        const token = raw.slice(0, MAX_TOKEN_LENGTH);
        if (!out.includes(token)) out.push(token);
        if (out.length >= MAX_TOKENS) break;
    }
    return out;
}

/**
 * Los dígitos de una palabra con FORMA DE TELÉFONO —dígitos con signos de
 * marcar, al menos 3— («(300)» → «300», «111-2233» → «1112233»). Un código
 * con letras («N-1») no: su «1» suelto encontraría cualquier cosa. Si es
 * sólo dígitos, cadena vacía (ya es su propia forma).
 */
export function searchTokenDigits(token: string): string {
    if (!/^[\d+().\-/]+$/.test(token)) return '';
    const digits = token.replace(/\D+/g, '');
    return digits.length >= 3 && digits !== token ? digits : '';
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
 * Patrón de expresión regular (sintaxis ARE de Postgres) que encuentra una
 * palabra YA PLEGADA en un texto sin plegar: cada letra se vuelve una clase
 * con su mayúscula y sus variantes acentuadas (`a` → `[aAáÁàÀ…]`) y todo lo
 * demás va escapado (literal). Se compara con `~` (sensible a mayúsculas) a
 * propósito: no depende de cómo pliega el locale de la base y no hay que
 * transformar el texto de cada fila — es lo que lo mantiene rápido (≈ un
 * ILIKE) sobre listas de 100k registros. Con dígitos y signos, la palabra
 * también vale escrita sólo con sus dígitos (teléfonos).
 */
export function searchTokenPattern(token: string): string {
    let out = '';
    for (const ch of token) {
        const lower = ch.toLowerCase();
        const upper = ch.toUpperCase();
        const set = [...new Set([lower, ...(upper.length === 1 ? [upper] : []), ...(VARIANTS.get(lower) ?? [])])];
        if (set.length > 1) out += `[${set.join('')}]`;
        else if (/[\p{L}\p{N}_]/u.test(ch)) out += ch;
        // Un `\` seguido de algo que no es letra ni número es un literal en ARE.
        else out += `\\${ch}`;
    }
    const digits = searchTokenDigits(token);
    return digits === '' ? out : `(?:${out}|${digits})`;
}

/**
 * ¿El texto (ya juntado y plegado, con los teléfonos también en dígitos)
 * contiene todas las palabras? Lo usa la búsqueda in-memory; el servidor
 * hace lo mismo con `searchTokenPattern`.
 */
export function matchesSearchTokens(foldedBlob: string, tokens: readonly string[]): boolean {
    return tokens.every((t) => {
        if (foldedBlob.includes(t)) return true;
        const digits = searchTokenDigits(t);
        return digits !== '' && foldedBlob.includes(digits);
    });
}
