import { escapeRefName } from './lexer';
import { refDisplayName, type FormulaFieldRef } from './refs';

/**
 * Fórmulas (A1) — un campo `computed` (las 8 operaciones fijas de siempre)
 * como la fórmula equivalente, escrita por NOMBRE. La usa la interfaz para
 * ofrecer «Convertir en fórmula»: los dos tipos se calculan al leer, así que
 * no hay datos que mover; la persona revisa la fórmula antes de guardar.
 *
 * Diferencias que conviene saber (las dice la interfaz): en una fórmula un
 * campo vacío cuenta como 0 en una cuenta (el calculado dejaba el resultado
 * vacío) y dividir por cero da error en vez de quedar vacío.
 *
 * Devuelve null si la config no alcanza para armar una fórmula.
 */
export function computedToFormula(config: Record<string, unknown>, fields: readonly FormulaFieldRef[]): string | null {
    const operation = typeof config.operation === 'string' ? config.operation : '';
    const rawInputs = Array.isArray(config.inputs) ? config.inputs : [];
    const refs: string[] = [];
    for (const raw of rawInputs) {
        const id = typeof raw === 'number' ? raw : Number(raw);
        const field = fields.find((f) => f.id === id);
        if (!field) continue;
        refs.push(`{${escapeRefName(refDisplayName(field, fields))}}`);
    }
    if (refs.length === 0) return null;
    const a = refs[0]!;
    const b = refs[1];
    switch (operation) {
        case 'sum':
            return refs.length === 1 ? `SUMA(${a})` : `SUMA(${refs.join(', ')})`;
        case 'product':
            return refs.join(' * ');
        case 'subtract':
            return b ? `${a} - ${b}` : null;
        case 'divide':
            return b ? `${a} / ${b}` : null;
        case 'abs':
            return `ABS(${a})`;
        case 'concat': {
            const sep = typeof config.separator === 'string' ? config.separator : ' ';
            if (refs.length === 1) return a;
            const sepText = `"${sep.replace(/\\/g, '\\\\').replace(/"/g, '""')}"`;
            return `CONCATENAR(${refs.join(`, ${sepText}, `)})`;
        }
        case 'date_diff_days':
            return b ? `DIAS_ENTRE(${a}, ${b})` : null;
        case 'date_diff_months':
            // Meses de calendario (como el calculado): no cuenta los días.
            return b ? `(ANIO(${b}) - ANIO(${a})) * 12 + MES(${b}) - MES(${a})` : null;
        default:
            return null;
    }
}
