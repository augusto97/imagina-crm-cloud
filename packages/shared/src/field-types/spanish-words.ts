/**
 * v0.1.266 (ADR-S35) — Números y fechas EN PALABRAS, en español.
 *
 * Una cuenta de cobro, un recibo o un pagaré dicen el monto dos veces: en
 * cifras y en letras ("la suma de UN MILLÓN QUINIENTOS MIL PESOS M/CTE").
 * Los modificadores `{{valor|letras}}`, `{{valor|pesos}}` y `{{fecha|larga}}`
 * de las variables usan estas funciones (documentos PDF y correos).
 *
 * Reglas del español para montos: se apocopan "uno" y "veintiuno" delante de
 * un sustantivo o de "mil" ("un peso", "veintiún mil"), "cien" exacto y
 * "ciento" en adelante, "un millón" / "dos millones", y "de" entre un millón
 * redondo y la moneda ("un millón de pesos", pero "un millón quinientos mil
 * pesos").
 */

const UNITS = [
    'cero', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
    'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve',
    'veinte', 'veintiún', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete',
    'veintiocho', 'veintinueve',
];
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = [
    '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos',
    'ochocientos', 'novecientos',
];

/** 0..999 en palabras (forma apocopada: "un", "veintiún"). */
function underThousand(n: number): string {
    if (n === 0) return '';
    if (n === 100) return 'cien';
    const h = Math.floor(n / 100);
    const rest = n % 100;
    const parts: string[] = [];
    if (h > 0) parts.push(HUNDREDS[h]!);
    if (rest > 0) {
        if (rest < 30) parts.push(UNITS[rest]!);
        else {
            const t = Math.floor(rest / 10);
            const u = rest % 10;
            parts.push(u === 0 ? TENS[t]! : `${TENS[t]!} y ${UNITS[u]!}`);
        }
    }
    return parts.join(' ');
}

/** 0..999.999 en palabras. */
function underMillion(n: number): string {
    const thousands = Math.floor(n / 1000);
    const rest = n % 1000;
    const parts: string[] = [];
    if (thousands === 1) parts.push('mil');
    else if (thousands > 1) parts.push(`${underThousand(thousands)} mil`);
    if (rest > 0) parts.push(underThousand(rest));
    return parts.join(' ');
}

/**
 * Entero no negativo en palabras: 1500000 → "un millón quinientos mil".
 * Hasta 999.999.999.999.999 (billones); más allá devuelve las cifras.
 */
export function integerToSpanishWords(value: number): string {
    const n = Math.floor(Math.abs(value));
    if (!Number.isFinite(n) || n > 999_999_999_999_999) return String(value);
    if (n === 0) return 'cero';
    const billions = Math.floor(n / 1_000_000_000_000);
    const millions = Math.floor((n % 1_000_000_000_000) / 1_000_000);
    const rest = n % 1_000_000;
    const parts: string[] = [];
    if (billions > 0) parts.push(billions === 1 ? 'un billón' : `${underMillion(billions)} billones`);
    if (millions > 0) parts.push(millions === 1 ? 'un millón' : `${underMillion(millions)} millones`);
    if (rest > 0) parts.push(underMillion(rest));
    const words = parts.join(' ');
    return value < 0 ? `menos ${words}` : words;
}

/**
 * Número (entero o con decimales) en palabras: 1234.5 → "mil doscientos
 * treinta y cuatro con 50/100". Los decimales se escriben como fracción, que
 * es como se escriben en un cheque o en una cuenta de cobro.
 */
export function numberToSpanishWords(value: number, decimals = 2): string {
    if (!Number.isFinite(value)) return '';
    const abs = Math.abs(value);
    const factor = 10 ** decimals;
    const rounded = Math.round(abs * factor);
    const int = Math.floor(rounded / factor);
    const frac = rounded % factor;
    const words = integerToSpanishWords(value < 0 ? -int : int);
    return frac > 0 ? `${words} con ${String(frac).padStart(decimals, '0')}/${factor}` : words;
}

/**
 * Monto en pesos en palabras: 1000000 → "un millón de pesos",
 * 1500000 → "un millón quinientos mil pesos", 1500.5 → "mil quinientos
 * pesos con cincuenta centavos".
 */
export function amountToSpanishWords(value: number, currency: { singular: string; plural: string } = { singular: 'peso', plural: 'pesos' }): string {
    if (!Number.isFinite(value)) return '';
    const rounded = Math.round(Math.abs(value) * 100);
    const int = Math.floor(rounded / 100);
    const cents = rounded % 100;
    const words = integerToSpanishWords(int);
    // "un millón DE pesos": un millón (o billón) redondo lleva "de".
    const needsDe = int > 0 && int % 1_000_000 === 0;
    const unit = int === 1 ? currency.singular : currency.plural;
    let out = `${words}${needsDe ? ' de' : ''} ${unit}`;
    if (cents > 0) out += ` con ${integerToSpanishWords(cents)} ${cents === 1 ? 'centavo' : 'centavos'}`;
    return value < 0 ? `menos ${out}` : out;
}

const MONTHS = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre',
    'diciembre',
];

/** "2026-10-08" (o "2026-10-08 14:30…") → "8 de octubre de 2026". Otra cosa: tal cual. */
export function longSpanishDate(value: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
    if (!m) return value;
    const month = MONTHS[Number(m[2]) - 1];
    if (!month) return value;
    return `${Number(m[3])} de ${month} de ${m[1]}`;
}

/**
 * Lee un monto que puede venir como número o como texto escrito por una
 * persona ("1500000", "1.500.000", "1.234,56", "$ 99.90"). `null` si no es
 * un número.
 */
export function parseLooseAmount(raw: unknown): number | null {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
    if (typeof raw !== 'string') return null;
    let t = raw.replace(/[^\d.,-]/g, '');
    if (t === '' || t === '-') return null;
    const lastDot = t.lastIndexOf('.');
    const lastComma = t.lastIndexOf(',');
    if (lastDot >= 0 && lastComma >= 0) {
        t = lastComma > lastDot ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
    } else if (lastComma >= 0) {
        t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
    } else if (lastDot >= 0 && /^-?\d{1,3}(\.\d{3})+$/.test(t)) {
        t = t.replace(/\./g, '');
    }
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

/** Modificadores de PALABRAS de las variables (`{{valor|pesos|mayusculas}}`). */
export const WORD_MODIFIERS = ['letras', 'pesos', 'mayusculas', 'larga'] as const;

/**
 * Aplica los modificadores de palabras a un valor ya resuelto: `letras`
 * (número → palabras), `pesos` (monto → "… pesos"), `larga` (fecha →
 * "8 de octubre de 2026") y `mayusculas`. Un valor que no es número/fecha
 * pasa intacto por `letras`/`pesos`/`larga`: nunca rompe el texto.
 */
export function applyWordModifiers(text: string, raw: unknown, mods: readonly string[]): string {
    let out = text;
    if (mods.includes('letras') || mods.includes('pesos')) {
        const n = parseLooseAmount(typeof raw === 'number' ? raw : out);
        if (n !== null) out = mods.includes('pesos') ? amountToSpanishWords(n) : numberToSpanishWords(n);
    }
    if (mods.includes('larga')) out = longSpanishDate(out);
    if (mods.includes('mayusculas')) out = out.toLocaleUpperCase('es');
    return out;
}
