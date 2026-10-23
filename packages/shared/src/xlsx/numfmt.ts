/**
 * Qué ES un número de una celda de Excel según su formato. En el archivo una
 * fecha, un monto, un porcentaje y una duración son todos números; lo que
 * los distingue es el formato de número de la celda (`numFmtId` + código).
 */
export type NumFmtKind =
    | 'general'
    | 'number'
    | 'currency'
    | 'percent'
    /** Fecha sin hora (`dd/mm/yyyy`). */
    | 'date'
    /** Fecha con hora (`dd/mm/yyyy hh:mm`). */
    | 'datetime'
    /** Sólo la hora del día (`hh:mm`). */
    | 'time'
    /** Tiempo transcurrido (`[h]:mm`): una duración, no un momento. */
    | 'elapsed'
    | 'text';

/** Formatos INTEGRADOS de Excel (los que no traen código en styles.xml). */
const BUILTIN: Record<number, NumFmtKind> = {
    0: 'general',
    1: 'number',
    2: 'number',
    3: 'number',
    4: 'number',
    5: 'currency',
    6: 'currency',
    7: 'currency',
    8: 'currency',
    9: 'percent',
    10: 'percent',
    11: 'number',
    12: 'number',
    13: 'number',
    14: 'date',
    15: 'date',
    16: 'date',
    17: 'date',
    18: 'time',
    19: 'time',
    20: 'time',
    21: 'time',
    22: 'datetime',
    37: 'number',
    38: 'number',
    39: 'number',
    40: 'number',
    41: 'number',
    42: 'currency',
    43: 'number',
    44: 'currency',
    45: 'time',
    46: 'elapsed',
    47: 'time',
    48: 'number',
    49: 'text',
};

/** Ids reservados a formatos de fecha según el idioma (chino, japonés, coreano, tailandés). */
function isLocaleDateId(id: number): boolean {
    return (id >= 27 && id <= 36) || (id >= 50 && id <= 58) || (id >= 71 && id <= 81);
}

const CURRENCY_SYMBOLS = /[$€£¥₹₩₽₺₫₪฿₦₱]|R\$|S\/|Bs|Q(?=[\s\d#0])/;

/**
 * Clasifica un formato de número. `code` es el `formatCode` de un formato
 * propio (id ≥ 164); para los integrados basta el id.
 */
export function classifyNumFmt(id: number, code?: string | null): NumFmtKind {
    if (code === undefined || code === null || code === '') {
        if (id in BUILTIN) return BUILTIN[id]!;
        if (isLocaleDateId(id)) return 'date';
        return 'general';
    }
    return classifyFormatCode(code);
}

export function classifyFormatCode(code: string): NumFmtKind {
    const raw = code.trim();
    if (raw === '' || /^general$/i.test(raw)) return 'general';
    // Sólo la primera sección (positivos): `#,##0;[Red]-#,##0;"-"`.
    const first = firstSection(raw);
    const hasCurrency = hasCurrencyMarker(first);
    // Lo literal ("texto", \x, _x, *x) no cuenta como código.
    let s = first
        .replace(/"[^"]*"/g, '')
        .replace(/\\./g, '')
        .replace(/[_*]./g, '');
    // `[h]`, `[mm]`, `[ss]`: tiempo transcurrido (una duración).
    if (/\[(h+|m+|s+)\]/i.test(s)) return 'elapsed';
    // El resto de corchetes son colores, condiciones o el idioma/moneda (`[$-409]`, `[$€-C0A]`).
    s = s.replace(/\[[^\]]*\]/g, '');
    if (s.trim() === '@') return 'text';
    // `AM/PM` y `A/P` son de la hora (y sus letras no son días ni meses).
    const ampm = /a\/p|am\/pm/i.test(s);
    const lower = s.toLowerCase().replace(/am\/pm|a\/p/g, '');
    const hasDate = /[yd]/.test(lower);
    const hasTime = /[hs]/.test(lower) || ampm;
    if (hasDate) return hasTime ? 'datetime' : 'date';
    if (hasTime) return 'time';
    // `mmm-yy` ya entró por la `y`; una `m` suelta (`mmmm`) es un mes.
    if (/m/.test(lower) && !/[0#?]/.test(lower)) return 'date';
    if (s.includes('%')) return 'percent';
    if (hasCurrency) return 'currency';
    if (/[0#?]/.test(s)) return 'number';
    return 'general';
}

function firstSection(code: string): string {
    let inQuote = false;
    for (let i = 0; i < code.length; i++) {
        const ch = code[i];
        if (ch === '"') inQuote = !inQuote;
        else if (ch === '\\') i++;
        else if (ch === ';' && !inQuote) return code.slice(0, i);
    }
    return code;
}

function hasCurrencyMarker(section: string): boolean {
    // `[$€-C0A]`, `[$USD]`: moneda explícita. `[$-409]` es sólo el idioma.
    if (/\[\$[^\]-]/.test(section)) return true;
    const literals = [...section.matchAll(/"([^"]*)"/g)].map((m) => m[1] ?? '').join(' ');
    const bare = section.replace(/"[^"]*"/g, '').replace(/\[[^\]]*\]/g, '');
    // Un código ISO escrito como texto (`#,##0 "COP"`) también es moneda.
    return CURRENCY_SYMBOLS.test(literals) || /\b[A-Z]{3}\b/.test(literals) || CURRENCY_SYMBOLS.test(bare);
}
