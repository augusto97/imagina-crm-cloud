import type { AutonumberConfig } from '../schemas/field-rules';

/**
 * v0.1.300 — ID automático (`TCK-0001`, `PED-2026-0042`).
 *
 * El número lo asigna el SERVIDOR al crear el registro (un trigger de
 * Postgres con un contador por campo y año, bloqueado con la fila del
 * contador: dos altas a la vez nunca reciben el mismo número y un alta que se
 * revierte no deja hueco). El texto lo arma la función SQL
 * `imcrm_autonumber_text`; ésta es su gemela en TypeScript (la vista previa
 * del editor de campos y los tests de paridad). Si cambias una, cambia la
 * otra.
 */

export interface AutonumberSettings {
    prefix: string;
    separator: string;
    digits: number;
    start: number;
    yearly: boolean;
}

export const AUTONUMBER_DEFAULTS: AutonumberSettings = {
    prefix: '',
    separator: '-',
    digits: 4,
    start: 1,
    yearly: false,
};

/** La config del campo con los valores por defecto aplicados. */
export function autonumberSettings(config: Partial<AutonumberConfig> | Record<string, unknown> | null | undefined): AutonumberSettings {
    const c = (config ?? {}) as Record<string, unknown>;
    const digits = typeof c.digits === 'number' && Number.isInteger(c.digits) ? Math.min(Math.max(c.digits, 1), 10) : AUTONUMBER_DEFAULTS.digits;
    const start = typeof c.start === 'number' && Number.isFinite(c.start) ? Math.max(Math.floor(c.start), 0) : AUTONUMBER_DEFAULTS.start;
    return {
        prefix: typeof c.prefix === 'string' ? c.prefix.trim() : AUTONUMBER_DEFAULTS.prefix,
        separator: typeof c.separator === 'string' ? c.separator : AUTONUMBER_DEFAULTS.separator,
        digits,
        start,
        yearly: c.yearly === true,
    };
}

/**
 * Texto del ID: `[prefijo][sep][año][sep]número`, sin separadores colgados
 * cuando una parte está vacía. El número se rellena con ceros hasta `digits`
 * y NUNCA se corta (TCK-9999 → TCK-10000).
 */
export function formatAutonumber(
    config: Partial<AutonumberConfig> | Record<string, unknown> | null | undefined,
    n: number,
    year?: number | null,
): string {
    const s = autonumberSettings(config);
    const num = String(Math.max(Math.floor(n), 0));
    const padded = num.length >= s.digits ? num : num.padStart(s.digits, '0');
    const parts = [s.prefix || null, s.yearly && year ? String(year) : null, padded].filter(
        (p): p is string => p !== null && p !== '',
    );
    return parts.join(s.separator);
}

/** Palabras que no aportan a una sigla («Órdenes de compra» → OC). */
const STOPWORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'o', 'u', 'en', 'para', 'por', 'a', 'al', 'con']);

/**
 * Prefijo sugerido al crear el campo: las primeras letras del nombre de la
 * lista en mayúsculas («Tickets» → TIC, «Pedidos» → PED) o las iniciales si
 * el nombre tiene varias palabras («Órdenes de compra» → OC). Sin acentos.
 */
export function suggestAutonumberPrefix(listName: string): string {
    const plain = listName
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Za-z0-9 ]+/g, ' ')
        .trim();
    const words = plain.split(/\s+/).filter((w) => w !== '' && !STOPWORDS.has(w.toLowerCase()));
    if (words.length === 0) return 'ID';
    if (words.length >= 2) {
        return words
            .slice(0, 4)
            .map((w) => w[0]!)
            .join('')
            .toUpperCase();
    }
    return words[0]!.slice(0, 3).toUpperCase();
}
