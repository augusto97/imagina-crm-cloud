import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

/**
 * Filtra una lista de records in-memory según `query`. Pensado para
 * listas chicas (≤ ~500 registros) donde el round-trip al server
 * (~150-300ms de overhead WP bootstrap + RTT) es mucho más caro que
 * filtrar en el browser (~1-5ms en JS).
 *
 * Tokeniza el query igual que el backend (`Tokenizer.php`):
 *   lowercase + ASCII fold + split por whitespace/non-alphanum.
 *
 * Match: cada token del query debe estar contenido en al menos uno
 * de los valores searchables del record (text, long_text, email, url).
 * AND-mode (todos los tokens deben matchear), igual que LIKE %a%b%.
 */

const SEARCHABLE_TYPES = new Set(['text', 'long_text', 'email', 'url']);

const ACCENT_MAP: Record<string, string> = {
    á: 'a', à: 'a', ä: 'a', â: 'a', ã: 'a',
    é: 'e', è: 'e', ë: 'e', ê: 'e',
    í: 'i', ì: 'i', ï: 'i', î: 'i',
    ó: 'o', ò: 'o', ö: 'o', ô: 'o', õ: 'o',
    ú: 'u', ù: 'u', ü: 'u', û: 'u',
    ñ: 'n', ç: 'c',
};

function normalize(text: string): string {
    let out = text.toLowerCase();
    out = out.replace(/[áàäâãéèëêíìïîóòöôõúùüûñç]/g, (c) => ACCENT_MAP[c] ?? c);
    return out;
}

function tokenize(text: string): string[] {
    const norm = normalize(text);
    return norm.split(/[^a-z0-9_]+/).filter((t) => t.length >= 1);
}

/**
 * Construye el blob de texto buscable de un record (concat de campos
 * searchables). Memoizable a nivel de caller si hace falta.
 */
function buildBlob(record: RecordEntity, fields: FieldEntity[]): string {
    const parts: string[] = [];
    for (const f of fields) {
        if (! SEARCHABLE_TYPES.has(f.type)) continue;
        const v = record.fields[f.slug];
        if (v === null || v === undefined || v === '') continue;
        if (Array.isArray(v)) {
            parts.push(v.map(String).join(' '));
        } else {
            parts.push(String(v));
        }
    }
    return normalize(parts.join(' '));
}

/**
 * Filtra `records` que matcheen `query`. Devuelve la misma referencia
 * si el query está vacío (zero allocation hot path).
 */
export function clientSideSearch(
    records: RecordEntity[],
    query: string,
    fields: FieldEntity[],
): RecordEntity[] {
    const tokens = tokenize(query);
    if (tokens.length === 0) return records;

    return records.filter((r) => {
        const blob = buildBlob(r, fields);
        return tokens.every((t) => blob.includes(t));
    });
}
