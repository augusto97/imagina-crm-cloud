/**
 * Costo tipeado a mano → número (v0.1.209). En Latinoamérica se escribe
 * "12.500" (punto de miles) y "12.500,50"; también llega "12500.5". El último
 * separador de dos es el decimal; uno solo seguido de grupos de a tres es de
 * miles. Vacío o inválido → null.
 */
export function parseMoney(raw: string): number | null {
    const s = raw.trim().replace(/\s/g, '');
    if (s === '') return null;
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    let normalized = s;
    if (lastDot >= 0 && lastComma >= 0) {
        // El último separador es el decimal; el otro, de miles.
        normalized = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lastComma >= 0) {
        normalized = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) {
        normalized = s.replace(/\./g, '');
    }
    const n = Number(normalized);
    return Number.isFinite(n) && n >= 0 ? n : null;
}
