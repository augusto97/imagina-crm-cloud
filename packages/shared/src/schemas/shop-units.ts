import { groupNumberPlain } from './shop-number';
import type { TenantFormat } from './tenant';

/**
 * v0.1.429 (ADR-S103) — Unidades de venta de la tienda.
 *
 * Cada producto dice en qué se vende (hora, año, kg, licencia…) y cuánto se
 * puede comprar: el mínimo, el máximo y de a cuánto sube (`step`). Todo sale
 * de columnas del catálogo, así que cada producto decide lo suyo; una celda
 * vacía es lo de siempre: de a 1, desde 1 y sin unidad.
 *
 * Las cantidades válidas son `min`, `min + step`, `min + 2·step`… hasta el
 * máximo (y el stock). Se aceptan hasta 3 decimales («de a 0,5 kg»). Las
 * cuentas se hacen en milésimas enteras: los decimales de punto flotante no
 * suman bien.
 *
 * PURO y sin zod: lo usan el servidor (la cuenta que vale), el editor y la
 * página pública.
 */

/** El tope de una línea del carrito (en la unidad del producto). */
export const SHOP_MAX_QTY = 10_000;
/** Cuántos decimales puede tener una cantidad. */
export const SHOP_QTY_DECIMALS = 3;
const SCALE = 10 ** SHOP_QTY_DECIMALS;
/** El paso más chico: 0,001. */
const MIN_STEP = 1 / SCALE;

export interface ShopUnit {
    /** «hora», «año», «kg». */
    one: string;
    /** «horas», «años», «kg». */
    many: string;
}

export interface ShopQtyRule {
    /** La cantidad más chica que se puede comprar. */
    min: number;
    /** La más grande (null = sin tope, salvo el stock y `SHOP_MAX_QTY`). */
    max: number | null;
    /** De a cuánto sube o baja. */
    step: number;
}

export const SHOP_DEFAULT_QTY_RULE: ShopQtyRule = { min: 1, max: null, step: 1 };

/** Redondea a milésimas (3 decimales). */
export function roundShopQty(n: number): number {
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * SCALE) / SCALE;
}

function units(n: number): number {
    return Math.round(n * SCALE);
}

// ── La regla de cada producto ───────────────────────────────────────────

function positive(v: unknown): number | null {
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN;
    if (!Number.isFinite(n) || n <= 0) return null;
    const r = roundShopQty(n);
    return r >= MIN_STEP ? Math.min(SHOP_MAX_QTY, r) : null;
}

/**
 * La regla de un producto a partir de sus columnas. Vacío o inválido = lo de
 * siempre. Sin mínimo, el mínimo es el paso («de a 5» empieza en 5; «de a
 * 0,5 kg», en 0,5). Un máximo menor que el mínimo se ignora. Devuelve null si
 * queda igual a la regla por defecto (no viaja).
 */
export function shopQtyRuleFrom(raw: { min?: unknown; max?: unknown; step?: unknown }): ShopQtyRule | null {
    const step = positive(raw.step) ?? 1;
    const min = positive(raw.min) ?? step;
    let max = positive(raw.max);
    if (max !== null && max < min) max = null;
    if (min === 1 && step === 1 && max === null) return null;
    return { min, max, step };
}

/** Cuántos decimales usan las cantidades de la regla (0 = enteras). */
export function shopQtyDecimals(rule: ShopQtyRule | null | undefined): number {
    const r = rule ?? SHOP_DEFAULT_QTY_RULE;
    let d = 0;
    for (const n of [r.min, r.step]) {
        const u = units(n);
        if (u % SCALE === 0) continue;
        d = Math.max(d, u % 100 === 0 ? 1 : u % 10 === 0 ? 2 : 3);
    }
    return d;
}

/**
 * La cantidad más grande válida que no pasa de `cap` (el máximo, el stock o
 * `SHOP_MAX_QTY`). 0 = no alcanza ni para el mínimo.
 */
export function shopQtyCap(rule: ShopQtyRule | null | undefined, stock: number | null = null): number {
    const r = rule ?? SHOP_DEFAULT_QTY_RULE;
    let capU = units(SHOP_MAX_QTY);
    if (r.max !== null) capU = Math.min(capU, units(r.max));
    if (stock !== null) capU = Math.min(capU, units(Math.max(0, stock)));
    const minU = units(r.min);
    const stepU = Math.max(1, units(r.step));
    if (capU < minU) return 0;
    const k = Math.floor((capU - minU) / stepU);
    return (minU + k * stepU) / SCALE;
}

/**
 * Lleva una cantidad a la válida más cercana: por debajo del mínimo (pero
 * más de 0) sube al mínimo, entre dos pasos va al más cercano y arriba del
 * tope baja al tope. 0 o menos = 0 (sale del carrito).
 */
export function snapShopQty(qty: number, rule: ShopQtyRule | null | undefined, stock: number | null = null): number {
    if (!Number.isFinite(qty) || qty <= 0) return 0;
    const r = rule ?? SHOP_DEFAULT_QTY_RULE;
    const cap = shopQtyCap(r, stock);
    const qU = units(qty);
    const minU = units(r.min);
    const stepU = Math.max(1, units(r.step));
    let v = qU <= minU ? minU : minU + Math.round((qU - minU) / stepU) * stepU;
    const capU = units(cap);
    if (cap > 0 && v > capU) v = capU;
    if (cap === 0) v = minU;
    return v / SCALE;
}

/** El siguiente valor al apretar «+» (dir 1) o «−» (dir −1). Bajar del mínimo = 0. */
export function shopQtyNext(qty: number, rule: ShopQtyRule | null | undefined, dir: 1 | -1, stock: number | null = null): number {
    const r = rule ?? SHOP_DEFAULT_QTY_RULE;
    const cap = shopQtyCap(r, stock);
    if (dir > 0) {
        if (qty <= 0) return cap > 0 ? r.min : 0;
        const next = roundShopQty(snapShopQty(qty, r) + r.step);
        return cap > 0 ? Math.min(cap, next) : qty;
    }
    const prev = roundShopQty(snapShopQty(qty, r) - r.step);
    return prev < r.min - MIN_STEP / 2 ? 0 : prev;
}

/** ¿Es una cantidad válida para la regla (sin mirar el stock)? */
export function shopQtyValid(qty: number, rule: ShopQtyRule | null | undefined): boolean {
    return qty > 0 && snapShopQty(qty, rule) === roundShopQty(qty);
}

// ── La unidad, en palabras ──────────────────────────────────────────────

const ACCENTS: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' };

function pluralWord(w: string): string {
    if (!w) return w;
    // Símbolos y abreviaturas: kg, m², GB, kWh, 2x1.
    if (!/^[\p{L}]+$/u.test(w) || !/[aeiouáéíóúü]/i.test(w) || (w.length > 1 && w === w.toUpperCase())) return w;
    const lower = w.toLowerCase();
    const last = lower[lower.length - 1]!;
    if ('aeiouáéó'.includes(last)) return `${w}s`;
    if (last === 'í' || last === 'ú') return `${w}s`;
    if (last === 'z') return `${w.slice(0, -1)}${w[w.length - 1] === 'Z' ? 'CES' : 'ces'}`;
    if (last === 's' || last === 'x') {
        // «mes» → «meses»; «lunes», «análisis» no cambian.
        const vowels = lower.match(/[aeiouáéíóú]+/g) ?? [];
        return vowels.length <= 1 ? `${w}es` : w;
    }
    // «sesión» → «sesiones»: la tilde de la última sílaba se va.
    const m = /([áéíóú])([^aeiouáéíóú]*)$/i.exec(w);
    const base = m ? w.slice(0, m.index) + (ACCENTS[m[1]!.toLowerCase()] ?? m[1]) + m[2] : w;
    return `${base}es`;
}

/** «hora» → «horas», «metro cuadrado» → «metros cuadrados», «hora de asesoría» → «horas de asesoría». */
export function pluralizeShopUnit(one: string): string {
    const t = one.trim().replace(/\s+/g, ' ');
    if (!t) return t;
    const cut = t.search(/\s(de|del|por|en|para|con)\s/i);
    const head = cut >= 0 ? t.slice(0, cut) : t;
    const tail = cut >= 0 ? t.slice(cut) : '';
    return head.split(' ').map(pluralWord).join(' ') + tail;
}

/**
 * La unidad de un producto a partir de lo que dice su columna: «hora» (el
 * plural se arma solo) o «mes/meses» (singular y plural a mano). Vacío o
 * «unidad» = sin unidad (lo de siempre).
 */
export function shopUnitFrom(raw: unknown): ShopUnit | null {
    if (typeof raw !== 'string') return null;
    const t = raw.trim().replace(/\s+/g, ' ').slice(0, 40);
    if (!t) return null;
    const slash = t.indexOf('/');
    let one = t;
    let many = '';
    if (slash > 0 && slash < t.length - 1 && !/\d/.test(t)) {
        one = t.slice(0, slash).trim();
        many = t.slice(slash + 1).trim();
    }
    if (!one) return null;
    if (/^(unidad|unidades|und|unid|u)$/i.test(one)) return null;
    return { one: one.slice(0, 30), many: (many || pluralizeShopUnit(one)).slice(0, 30) };
}

function lowerFirst(s: string): string {
    // «Hora» como opción de una lista: en una frase va en minúscula (no las siglas: «GB»).
    return s.length > 1 && s[0] === s[0]!.toUpperCase() && s[1] === s[1]!.toLowerCase() ? s[0]!.toLowerCase() + s.slice(1) : s;
}

/** La cantidad como número, con los separadores de la empresa («1,5»). */
export function formatShopQty(qty: number, format: TenantFormat['number_format']): string {
    return groupNumberPlain(roundShopQty(qty), null, format);
}

/** «3 horas», «1 hora», «1,5 kg»; sin unidad, el número. */
export function shopQtyText(qty: number, unit: ShopUnit | null | undefined, format: TenantFormat['number_format']): string {
    const n = formatShopQty(qty, format);
    if (!unit) return n;
    return `${n} ${lowerFirst(roundShopQty(qty) === 1 ? unit.one : unit.many)}`;
}

/**
 * Lo que va sobre el selector de cantidad: «Horas», «Licencias»; con una
 * abreviatura o un símbolo (kg, m², GB) «Cantidad (kg)»; sin unidad, «Cantidad».
 */
export function shopQtyLabel(unit: ShopUnit | null | undefined): string {
    if (!unit) return 'Cantidad';
    const m = unit.many;
    if (m === unit.one && !/\s/.test(m)) return `Cantidad (${m})`;
    return m.charAt(0).toUpperCase() + m.slice(1);
}

/** « / hora» junto al precio (vacío sin unidad). */
export function shopPerUnit(unit: ShopUnit | null | undefined): string {
    return unit ? ` / ${lowerFirst(unit.one)}` : '';
}

/**
 * La regla en una frase, para la ficha: «Mínimo 2 horas · de a 1 · máximo 40
 * horas». Vacío cuando no hay nada que contar (lo de siempre).
 */
export function shopQtyRuleText(rule: ShopQtyRule | null | undefined, unit: ShopUnit | null | undefined, format: TenantFormat['number_format']): string {
    if (!rule) return '';
    const parts: string[] = [];
    if (rule.min !== rule.step) parts.push(`mínimo ${shopQtyText(rule.min, unit, format)}`);
    if (rule.step !== 1) parts.push(`de a ${shopQtyText(rule.step, unit, format)}`);
    if (rule.max !== null) parts.push(`máximo ${shopQtyText(rule.max, unit, format)}`);
    if (parts.length === 0) return '';
    const s = parts.join(' · ');
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Lee una cantidad escrita por una persona: acepta coma o punto como decimal.
 * Con el formato de la empresa, «1.500» con punto de miles es 1500. null = no
 * es un número.
 */
export function parseShopQtyInput(raw: string, format?: TenantFormat['number_format']): number | null {
    let t = raw.trim().replace(/\s+/g, '');
    if (!t) return null;
    const thousands = format === 'dot_comma' ? '.' : format === 'comma_dot' ? ',' : null;
    if (thousands && new RegExp(`^\\d{1,3}(\\${thousands}\\d{3})+$`).test(t)) t = t.split(thousands).join('');
    if (!/^\d{1,6}([.,]\d{1,3})?$/.test(t)) return null;
    const n = Number(t.replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? roundShopQty(n) : null;
}
