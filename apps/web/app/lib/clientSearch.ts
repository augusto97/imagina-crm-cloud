import { foldSearchText, matchesSearchTokens, SEARCHABLE_FIELD_TYPES, searchTokens } from '@imagina-base/shared';

import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

/**
 * Filtra una lista de records in-memory según `query`. Pensado para
 * listas chicas (≤ ~500 registros) donde el round-trip al server es mucho
 * más caro que filtrar en el browser (~1-5ms en JS).
 *
 * v0.1.286 — la MISMA regla que el servidor (`searchTokens` en shared): las
 * palabras se pliegan (sin acentos ni mayúsculas) y se exigen TODAS, cada una
 * en cualquier campo buscable. Antes el servidor hacía un único ILIKE sensible
 * a los acentos y la misma búsqueda daba resultados distintos según el tamaño
 * de la lista («alvaro»: 6 en una lista chica, 0 en una grande).
 */

/**
 * v0.1.188 — ¿se puede buscar esta tanda en el navegador? Sólo si NINGÚN
 * registro tiene descripción: el documento no viaja en el listado (a
 * propósito, pesa), así que filtrar in-memory dejaría afuera lo escrito en
 * el cuerpo del registro. Con alguna descripción la búsqueda va al servidor,
 * que sí la incluye.
 */
export function canSearchClientSide(records: ReadonlyArray<Pick<RecordEntity, 'has_description'>>): boolean {
    return records.every((r) => r.has_description !== true);
}

/**
 * Texto buscable de un record (los campos buscables juntos, plegado). Un
 * teléfono entra también SÓLO CON DÍGITOS («3001112233» encuentra un
 * «300 111 2233» cargado a mano), igual que en el servidor.
 */
function buildBlob(record: RecordEntity, fields: FieldEntity[]): string {
    const parts: string[] = [];
    for (const f of fields) {
        if (! SEARCHABLE_FIELD_TYPES.has(f.type)) continue;
        const v = record.fields[f.slug];
        if (v === null || v === undefined || v === '') continue;
        const text = Array.isArray(v) ? v.map(String).join(' ') : String(v);
        parts.push(text);
        if (f.type === 'phone') parts.push(text.replace(/\D+/g, ''));
    }
    return foldSearchText(parts.join(' '));
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
    const tokens = searchTokens(query);
    if (tokens.length === 0) {
        // Sin letras ni números (p. ej. «@»): la cadena tal cual.
        const needle = foldSearchText(query.trim());
        if (needle === '') return records;
        return records.filter((r) => buildBlob(r, fields).includes(needle));
    }
    return records.filter((r) => matchesSearchTokens(buildBlob(r, fields), tokens));
}
