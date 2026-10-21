import {
    jsonbKeyForField,
    SEARCHABLE_FIELD_TYPES,
    searchTokenDigits,
    searchTokenPattern,
    searchTokens,
    type Field,
} from '@imagina-base/shared';
import { sql, type SQL } from 'drizzle-orm';
import { records } from '../db/schema';

/**
 * WHERE de la búsqueda de texto de registros (listado, vista agrupada, pie de
 * la tabla, edición masiva, export). Misma regla que la búsqueda in-memory del
 * navegador (`searchTokens` en shared):
 *
 *  - las palabras se exigen TODAS (AND), cada una en cualquier campo buscable
 *    o en la descripción del registro (v0.1.188);
 *  - sin distinguir acentos ni mayúsculas: «alvaro» encuentra «Álvaro».
 *
 * Cómo: se juntan los textos buscables de la fila en UNA cadena y se compara
 * contra un patrón por palabra (`~ ALL (ARRAY[…])`, la cadena se arma una vez
 * por fila). El patrón lleva las variantes acentuadas dentro de la clase de
 * cada letra, así no hay que transformar el texto de cada fila — `translate`
 * o `unaccent` sobre 100k filas costaban 3-15× más (medido: 64 ms vs 200-800
 * ms). Los patrones viajan SIEMPRE como parámetros (regla de oro nº 4).
 *
 * Teléfono: además del texto se compara la versión SÓLO DÍGITOS del número,
 * así «3001112233» encuentra un «300 111 2233» cargado a mano.
 *
 * `fields` son los campos VISIBLES para quien busca (los ocultos no se buscan:
 * sería un oráculo, SEC-25).
 */
export function compileSearch(fields: readonly Field[], search: string | undefined): SQL | undefined {
    const needle = (search ?? '').trim().slice(0, 200);
    if (needle === '') return undefined;
    const targets = fields.filter((f) => SEARCHABLE_FIELD_TYPES.has(f.type));
    const tokens = searchTokens(needle);

    const parts: SQL[] = targets.map((f) => sql`(${records.data} ->> ${jsonbKeyForField(f.id)})`);
    parts.push(sql`${records.descriptionText}`);
    if (tokens.some((t) => searchTokenDigits(t) !== '')) {
        for (const f of targets) {
            if (f.type !== 'phone') continue;
            parts.push(sql`regexp_replace(${records.data} ->> ${jsonbKeyForField(f.id)}, '[^0-9]+', '', 'g')`);
        }
    }
    const blob = sql`concat_ws(' ', ${sql.join(parts, sql`, `)})`;

    // Sin letras ni números (p. ej. «@» o «+»): la cadena tal cual, escapada.
    if (tokens.length === 0) {
        const escaped = `%${needle.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
        return sql`${blob} ILIKE ${escaped}`;
    }
    const patterns = tokens.map((t) => sql`${searchTokenPattern(t)}`);
    return sql`${blob} ~ ALL (ARRAY[${sql.join(patterns, sql`, `)}]::text[])`;
}
