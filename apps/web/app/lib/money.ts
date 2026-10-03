/**
 * v0.1.251 — Un monto como lo escribe una persona en Latinoamérica:
 * «150.000» (punto de miles), «1.234,50», «99.90», «150,000». Devuelve 0 si
 * no es un número (el formulario lo trata como inválido).
 */
export function parseLocalAmount(raw: string): number {
    let t = raw.replace(/[^\d.,]/g, '');
    if (t === '') return 0;
    const lastDot = t.lastIndexOf('.');
    const lastComma = t.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
        // El último separador es el decimal.
        t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    } else if (lastComma >= 0) {
        t = /^\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
        t = t.replace(/\./g, '');
    }
    const n = Number(t);
    return Number.isFinite(n) ? n : 0;
}
