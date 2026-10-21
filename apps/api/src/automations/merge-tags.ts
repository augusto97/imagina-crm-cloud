import { applyWordModifiers, formatEmailFieldValue, zonedToday, type TenantFormat } from '@imagina-base/shared';

/**
 * Resuelve merge tags `{{slug}}` en un template contra los valores de un
 * registro. Soporta `{{record.id}}` y `{{slug}}` (valor del campo por slug).
 * Un array (multi_select) se une por coma.
 *
 * Modificadores de FECHA (v0.1.86, facturación con período anticipado/
 * vencido): `{{campo|+1m}}`, `{{campo|-1d}}`, encadenables —
 * `{{before.proximo_cobro|+1m|-1d}}` = "un mes menos un día después de la
 * fecha que venció" (el fin del período anticipado). Unidades: d (días),
 * m (meses, con clamp al último día — 31/01 +1m → 28/02), y (años). Si el
 * valor base no es una fecha (YYYY-MM-DD...), los modificadores se ignoran
 * y el valor pasa tal cual.
 *
 * Modificador de ETIQUETA (v0.1.178): `{{campo|label}}` devuelve la
 * ETIQUETA legible de la opción (select/multi_select → "Gestión sitio web"
 * en vez de `gestion_sitio_web`; checkbox → Sí/No). El default sigue siendo
 * el VALUE — es lo que otro sistema espera como clave y lo que un
 * `create_record`/`update_field` necesita para escribir en un select. El
 * autor elige por tag: `|label` para correos y mensajes, nada (o `|value`,
 * explícito) para integraciones. La resolución la aporta el llamador vía
 * `resolveLabel` (necesita el catálogo de campos); sin él, `|label` pasa
 * el valor tal cual — nunca rompe el template.
 *
 * Modificadores de PALABRAS (v0.1.266, documentos PDF): `{{valor|letras}}`
 * ("un millón quinientos mil"), `{{valor|pesos}}` ("un millón de pesos"),
 * `{{fecha|larga}}` ("8 de octubre de 2026") y `{{x|mayusculas}}`.
 * Encadenables: `{{valor|pesos|mayusculas}}`.
 *
 * Modificadores de FORMATO REGIONAL (auditoría de automatizaciones):
 * `{{cita|fecha}}` («21/10/2026»), `{{cita|fechahora}}` («21/10/2026 14:30»
 * en la zona de la empresa), `{{monto|moneda}}` («COP 1.250.000») y
 * `{{monto|numero}}` («1.250.000»). Los resuelve `formatValue` (lo arma el
 * llamador con el formato regional y el catálogo de campos); sin él, pasan
 * el valor tal cual. El default sigue siendo el valor CRUDO (v0.1.178): es
 * lo que otro sistema espera.
 *
 * `escapeValue` (SEC-08): cuando el destino es HTML (email is_html), se pasa un
 * escapador para que los VALORES interpolados (datos del registro, que pueden
 * venir de un cliente del portal o de un import) no inyecten HTML/JS. El
 * template en sí lo autoró el admin y NO se escapa.
 */
export function applyMergeTags(
    template: string,
    fieldValue: (slug: string) => unknown,
    recordId: number | null,
    escapeValue?: (s: string) => string,
    resolveLabel?: (token: string, value: unknown) => unknown,
    formatValue?: MergeFormatter,
): string {
    if (!template) return template;
    const esc = escapeValue ?? ((s: string) => s);
    return template.replace(MERGE_TAG_RE, (_m, token: string, mods: string) => {
        let v: unknown;
        if (token === 'record.id') {
            v = recordId === null ? '' : String(recordId);
        } else {
            v = fieldValue(token);
        }
        if (mods.split('|').includes('label') && resolveLabel) {
            v = resolveLabel(token, v);
        }
        if (v === null || v === undefined) return '';
        const list = mods ? mods.split('|').filter(Boolean) : [];
        const fmt = list.find((m): m is FormatModifier => (FORMAT_MODIFIERS as readonly string[]).includes(m));
        if (Array.isArray(v)) return esc(applyWordModifiers(v.map((x) => String(x)).join(', '), v, list));
        let out = String(v);
        if (mods) out = applyDateModifiers(out, mods);
        if (fmt && formatValue) {
            // Con aritmética de fechas (`|+1m|fecha`) se formatea el resultado.
            const formatted = formatValue(token, out !== String(v) ? out : v, fmt);
            if (formatted !== undefined) out = formatted;
        }
        // v0.1.266 — `|letras`, `|pesos`, `|larga`, `|mayusculas`.
        if (list.length > 0) out = applyWordModifiers(out, typeof v === 'number' ? v : out, list);
        return esc(out);
    });
}

/** Modificadores de formato regional (los resuelve `formatValue`). */
export const FORMAT_MODIFIERS = ['fecha', 'fechahora', 'moneda', 'numero'] as const;
export type FormatModifier = (typeof FORMAT_MODIFIERS)[number];
export type MergeFormatter = (token: string, value: unknown, mod: FormatModifier) => string | undefined;

/** `{{token|mod|mod}}` — el mismo patrón en el motor, el probador y los tests. */
export const MERGE_TAG_RE =
    /\{\{\s*([a-zA-Z0-9_.]+)((?:\|(?:[+-]\d+[dmy]|label|value|letras|pesos|mayusculas|larga|fecha|fechahora|moneda|numero))*)\s*\}\}/g;

/**
 * Si la plantilla es UNA sola variable sin modificadores (`{{monto}}`),
 * su token; si no, null. Al escribir un campo, esa variable se copia con su
 * valor CRUDO (número, lista de opciones, booleano) en vez de pasar a texto
 * — antes `{{tags}}` llegaba como «vip, promo» y `{{monto}}` como «1250000».
 */
export function singleTagToken(template: string): string | null {
    const m = /^\s*\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}\s*$/.exec(template);
    return m ? m[1]! : null;
}

/**
 * Formateador de `|fecha`, `|fechahora`, `|moneda` y `|numero` con el formato
 * regional de la empresa (separadores, orden de la fecha, 12/24 h) y su zona.
 * Usa la config del campo cuando el token es un campo (moneda y decimales).
 */
export function regionalFormatterFor(
    fieldsBySlug: ReadonlyMap<string, LabelFieldLike>,
    format: Pick<TenantFormat, 'number_format' | 'date_format' | 'time_format'>,
    timeZone: string,
): MergeFormatter {
    const fmt = { ...format, timezone: timeZone };
    return (token, value, mod) => {
        const slug = token.startsWith('before.') ? token.slice('before.'.length) : token;
        const field = fieldsBySlug.get(slug);
        if (mod === 'fecha' || mod === 'fechahora') {
            if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return undefined;
            const hasTime = /^\d{4}-\d{2}-\d{2}[ T]\d/.test(value);
            if (!hasTime) return formatEmailFieldValue({ type: 'date', config: {} }, value.slice(0, 10), fmt);
            // Un instante sin zona (`{{date.now}}`) es UTC, como lo guarda la app.
            const iso = /[zZ]|[+-]\d{2}:?\d{2}$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
            const at = new Date(iso);
            if (Number.isNaN(at.getTime())) return undefined;
            if (mod === 'fechahora') return formatEmailFieldValue({ type: 'datetime', config: {} }, at.toISOString(), fmt);
            return formatEmailFieldValue({ type: 'date', config: {} }, zonedToday(timeZone, at), fmt);
        }
        const n = typeof value === 'number' ? value : Number(String(value).trim());
        if (!Number.isFinite(n)) return undefined;
        const cfg = field && (field.type === 'number' || field.type === 'currency') ? field.config : {};
        return formatEmailFieldValue({ type: mod === 'moneda' ? 'currency' : 'number', config: cfg }, n, fmt);
    };
}

/** Lo mínimo de un campo que hace falta para traducir value → etiqueta. */
export interface LabelFieldLike {
    type: string;
    config: unknown;
    /** v0.1.265 — nombre visible (bloque «Datos del registro» del correo). */
    label?: string;
}

/**
 * Traduce el VALUE guardado de un campo a lo que la persona LEE en la
 * ficha: la etiqueta de la opción en select/multi_select (un value sin
 * opción se devuelve tal cual — mejor el dato crudo que perderlo) y Sí/No
 * en checkbox. Para el resto de los tipos el valor ya es legible y pasa
 * intacto. Puro y sin dependencias: lo usan el motor y el probador.
 */
export function labelForFieldValue(field: LabelFieldLike | undefined, value: unknown): unknown {
    if (!field || value === null || value === undefined) return value;
    if (field.type === 'checkbox') {
        if (typeof value === 'boolean') return value ? 'Sí' : 'No';
        return value;
    }
    if (field.type !== 'select' && field.type !== 'multi_select') return value;
    const raw = (field.config as { options?: unknown } | null | undefined)?.options;
    if (!Array.isArray(raw)) return value;
    const labels = new Map<string, string>();
    for (const opt of raw) {
        if (typeof opt !== 'object' || opt === null) continue;
        const o = opt as { value?: unknown; label?: unknown };
        if (typeof o.value === 'string' && typeof o.label === 'string' && o.label !== '') {
            labels.set(o.value, o.label);
        }
    }
    const one = (x: unknown): unknown => (typeof x === 'string' ? labels.get(x) ?? x : x);
    return Array.isArray(value) ? value.map(one) : one(value);
}

/**
 * Arma el `resolveLabel` de `applyMergeTags` a partir de un catálogo
 * slug → campo. Entiende los prefijos `before.` (mismo campo, valor
 * anterior) y devuelve el valor intacto para tokens de sistema/payload.
 */
export function labelResolverFor(
    fieldsBySlug: ReadonlyMap<string, LabelFieldLike>,
): (token: string, value: unknown) => unknown {
    return (token, value) => {
        const slug = token.startsWith('before.') ? token.slice('before.'.length) : token;
        return labelForFieldValue(fieldsBySlug.get(slug), value);
    };
}

/**
 * Aplica una cadena de modificadores (`|+1m|-1d`) a un valor fecha
 * `YYYY-MM-DD` (o datetime `YYYY-MM-DD ...` — se preserva la cola). Si el
 * valor no parsea como fecha, se devuelve intacto. Los modificadores que
 * no son de fecha (`label`, `value`) se ignoran aquí.
 */
export function applyDateModifiers(value: string, mods: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(value);
    if (!m) return value;
    let y = Number(m[1]);
    let mo = Number(m[2]); // 1-12
    let d = Number(m[3]);
    const tail = m[4] ?? '';

    for (const mod of mods.split('|').filter(Boolean)) {
        const mm = /^([+-])(\d+)([dmy])$/.exec(mod);
        if (!mm) continue;
        const sign = mm[1] === '-' ? -1 : 1;
        const n = sign * Number(mm[2]);
        if (mm[3] === 'd') {
            // Date.UTC normaliza overflow/underflow de días.
            const dt = new Date(Date.UTC(y, mo - 1, d + n));
            y = dt.getUTCFullYear();
            mo = dt.getUTCMonth() + 1;
            d = dt.getUTCDate();
        } else {
            // Meses/años: aritmética de componentes con CLAMP al último día
            // del mes destino (31/01 +1m → 28/02, no 03/03).
            const totalMonths = mm[3] === 'm' ? n : n * 12;
            const base = (mo - 1) + totalMonths;
            y += Math.floor(base / 12);
            mo = ((base % 12) + 12) % 12 + 1;
            const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
            if (d > lastDay) d = lastDay;
        }
    }
    const pad = (x: number): string => String(x).padStart(2, '0');
    return `${y}-${pad(mo)}-${pad(d)}${tail}`;
}

/** Escapa un valor para inyectarlo seguro en HTML (SEC-08 / SEC-33). */
export function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
    );
}
