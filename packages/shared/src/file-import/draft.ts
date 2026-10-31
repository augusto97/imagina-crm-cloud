import { checkValueRules } from '../field-types/field-rules';
import { slugify, RESERVED_FIELD_SLUGS } from '../schemas/slug';
import type { COLOR_PRESETS } from '../schemas/field';
import { findEntityCandidates, foldImportValue as fold, headerHints, linkMatch } from './profile';
import {
    FILE_IMPORT_DATA_KIND_LABELS,
    FILE_IMPORT_MAX_LISTS,
    type FileImportColumnProfile,
    type FileImportDataKind,
    type FileImportEntity,
    type FileImportField,
    type FileImportFieldType,
    type FileImportLink,
    type FileImportList,
    type FileImportOption,
    type FileImportPlan,
    type FileImportSheetProfile,
} from './schema';

type ColorPreset = (typeof COLOR_PRESETS)[number];

/**
 * v0.1.339 (ADR-S88) — El BORRADOR del plan: lo que se propone sin IA, sólo
 * con el perfil de cada hoja. Es la base que la IA afina (y lo que se usa tal
 * cual cuando no hay IA): nombres de listas y campos, la columna de título,
 * los tipos, las opciones con su color, qué descartar, qué columnas pasan a
 * una lista aparte y qué hojas se vinculan. Puro.
 */

export interface DraftSheet {
    profile: FileImportSheetProfile;
    /** Las filas de datos tal como se perfilaron (mismo recorte). */
    rows: readonly (readonly string[])[];
}

export interface DraftOptions {
    fileName: string;
    /** Moneda por defecto cuando el archivo no la dice («$» a secas). */
    currency?: string;
    /** País por defecto de los teléfonos. */
    country?: string;
}

const GENERIC_SHEET = /^(hoja|sheet|tabla|table|datos|data|plantilla|libro|book|base|export|exportacion|reporte|report)\s*\d*$/i;

/** «clientes_2026 (final).xlsx» → «Clientes 2026 (final)». */
export function fileBaseName(fileName: string): string {
    const base = fileName
        .replace(/\.[A-Za-z0-9]{2,5}$/, '')
        .replace(/[_]+/g, ' ')
        .replace(/\s*-\s*/g, ' - ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 70);
    return capitalize(base) || 'Mi lista';
}

function capitalize(s: string): string {
    return s.length === 0 ? s : s.charAt(0).toLocaleUpperCase('es') + s.slice(1);
}

/** «NOMBRE CLIENTE» → «Nombre cliente»; «fecha_de_pago» → «Fecha de pago». */
export function cleanFieldLabel(header: string): string {
    let s = header.replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
    const letters = s.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, '');
    if (letters.length > 3 && letters === letters.toLocaleUpperCase('es')) s = s.toLocaleLowerCase('es');
    return capitalize(s).slice(0, 80) || 'Campo';
}

/** «Cliente» → «Clientes»; «Nombre del proveedor» → «Proveedores». */
export function pluralName(header: string): string {
    const clean = cleanFieldLabel(header);
    const m = /^(?:nombre|razon social|razón social)\s+(?:del?|de la)\s+(.+)$/i.exec(clean);
    const base = capitalize(m ? m[1]! : clean);
    const words = base.split(' ');
    const first = words[0]!;
    const plural = /s$/i.test(first)
        ? first
        : /z$/i.test(first)
          ? `${first.slice(0, -1)}ces`
          : /[aeiouáéó]$/i.test(first)
            ? `${first}s`
            : `${first}es`;
    return [plural, ...words.slice(1)].join(' ').slice(0, 80);
}

// ── Qué clase de datos es ─────────────────────────────────────────────────

const KIND_WORDS: Record<Exclude<FileImportDataKind, 'generic'>, RegExp> = {
    contacts: /(cliente|contacto|correo|email|telefono|celular|whatsapp|empresa|cedula|nit\b|direccion)/,
    sales: /(oportunidad|etapa|negocio|venta|vendedor|cierre|prospecto|lead|pipeline|probabilidad|cotizacion)/,
    invoices: /(factura|cobro|pago|vencimiento|saldo|abono|cuota|iva\b|mora|recaudo)/,
    projects: /(tarea|proyecto|responsable|entrega|avance|prioridad|sprint|hito|actividad|pendiente)/,
    support: /(ticket|caso|solicitud|incidencia|soporte|sla\b|reclamo|queja|pqr)/,
    inventory: /(producto|sku|stock|inventario|existencia|bodega|referencia|unidades|cantidad)/,
    appointments: /(cita|agenda|paciente|consulta|turno|reserva|hora de)/,
    recruiting: /(candidato|vacante|cargo|hoja de vida|entrevista|postulacion|salario)/,
    events: /(evento|inscripcion|asistente|invitado|entrada|boleta|aforo)/,
    expenses: /(gasto|proveedor|compra|egreso|concepto|centro de costo)/,
};

export function detectDataKind(texts: readonly string[]): FileImportDataKind {
    const all = texts.map((t) => fold(t));
    let best: FileImportDataKind = 'generic';
    let bestScore = 0;
    for (const [kind, re] of Object.entries(KIND_WORDS) as Array<[Exclude<FileImportDataKind, 'generic'>, RegExp]>) {
        let score = 0;
        for (const t of all) if (re.test(t)) score++;
        // «Cliente» aparece en casi todo: pesa menos que una palabra propia del caso.
        if (kind === 'contacts') score *= 0.6;
        if (score > bestScore) {
            best = kind;
            bestScore = score;
        }
    }
    return bestScore >= 1.5 ? best : 'generic';
}

const KIND_LOOK: Record<FileImportDataKind, { icon: string; color: string }> = {
    contacts: { icon: 'users', color: '#2563eb' },
    sales: { icon: 'handshake', color: '#16a34a' },
    invoices: { icon: 'receipt', color: '#d97706' },
    projects: { icon: 'rocket', color: '#7c3aed' },
    support: { icon: 'headset', color: '#db2777' },
    inventory: { icon: 'package', color: '#0891b2' },
    appointments: { icon: 'calendar_check', color: '#0d9488' },
    recruiting: { icon: 'identification_card', color: '#4f46e5' },
    events: { icon: 'ticket', color: '#e11d48' },
    expenses: { icon: 'wallet', color: '#ea580c' },
    generic: { icon: 'table', color: '#475569' },
};

export function lookForKind(kind: FileImportDataKind): { icon: string; color: string } {
    return KIND_LOOK[kind];
}

/** El icono de una lista que sale de una columna («Cliente» → personas). */
function lookForName(name: string): { icon: string; color: string } {
    const n = fold(name);
    if (/(cliente|contacto|paciente|alumno|estudiante|invitado|asistente|socio|miembro)/.test(n)) return { icon: 'users', color: '#2563eb' };
    if (/(proveedor|transportador)/.test(n)) return { icon: 'truck', color: '#ea580c' };
    if (/(producto|articulo|item|referencia|servicio)/.test(n)) return { icon: 'package', color: '#0891b2' };
    if (/(vendedor|asesor|responsable|empleado|agente|colaborador)/.test(n)) return { icon: 'user', color: '#7c3aed' };
    if (/(empresa|compania|sede|sucursal)/.test(n)) return { icon: 'building', color: '#475569' };
    if (/(proyecto|campana)/.test(n)) return { icon: 'rocket', color: '#7c3aed' };
    return { icon: 'folder', color: '#64748b' };
}

// ── Opciones con color ────────────────────────────────────────────────────

const SEMANTIC_COLORS: Array<[RegExp, ColorPreset]> = [
    [/^(si|sí|activo|activa)$/, 'green'],
    [/(pagad|complet|terminad|cerrad|ganad|aprobad|entregad|resuelt|hecho|listo|confirmad|disponible|al dia|exitos|finalizad)/, 'green'],
    [/(vencid|perdid|rechazad|cancelad|anulad|inactiv|bloquead|urgente|en mora|agotad|fallid|^no$|critic)/, 'red'],
    [/(pendient|en proceso|en curso|en espera|revision|parcial|media|por pagar|por cobrar|negociaci|seguimiento)/, 'amber'],
    [/(nuev|abiert|borrador|propuesta|contactad|prospecto|cotizad|inicial)/, 'blue'],
    [/^alta$|alta prioridad/, 'red'],
    [/^baja$|baja prioridad/, 'gray'],
    [/(otro|otra|sin |n\/a|ningun|no aplica)/, 'gray'],
];
const PALETTE: readonly ColorPreset[] = ['blue', 'violet', 'teal', 'orange', 'pink', 'cyan', 'lime', 'indigo', 'fuchsia', 'sky', 'emerald', 'rose'];

export function colorForOption(label: string, index: number): ColorPreset {
    const f = fold(label);
    for (const [re, color] of SEMANTIC_COLORS) if (re.test(f)) return color;
    return PALETTE[index % PALETTE.length]!;
}

function optionLabel(raw: string): string {
    const t = raw.replace(/\s+/g, ' ').trim();
    const letters = t.replace(/[^A-Za-zÁÉÍÓÚÑÜáéíóúñü]/g, '');
    const s = letters.length > 3 && letters === letters.toLocaleUpperCase('es') ? t.toLocaleLowerCase('es') : t;
    return capitalize(s).slice(0, 80);
}

/** Las opciones de una columna (una por valor plegado, la forma más usada como etiqueta). */
export function buildOptions(values: readonly string[], type: 'select' | 'multi_select', max = 60): FileImportOption[] {
    const entries: Array<{ value: string; count: number }> = [];
    for (const raw of values) {
        const parts = type === 'multi_select' ? raw.split(/[,;\n]/) : [raw];
        for (const p of parts) entries.push({ value: p, count: 1 });
    }
    return buildOptionsWeighted(entries, max);
}

/** Igual que `buildOptions`, desde valores con su cantidad (el `top` del perfil). */
export function buildOptionsWeighted(entries: ReadonlyArray<{ value: string; count: number }>, max = 60): FileImportOption[] {
    const groups = new Map<string, { count: number; forms: Map<string, number> }>();
    for (const e of entries) {
        const t = e.value.replace(/\s+/g, ' ').trim();
        if (t === '') continue;
        const k = fold(t);
        const g = groups.get(k) ?? { count: 0, forms: new Map<string, number>() };
        g.count += e.count;
        g.forms.set(t, (g.forms.get(t) ?? 0) + e.count);
        groups.set(k, g);
    }
    const used = new Set<string>();
    return [...groups.values()]
        .sort((a, b) => b.count - a.count)
        .slice(0, max)
        .map((g, i) => {
            const forms = [...g.forms.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
            const label = optionLabel(forms[0]!);
            const base = slugify(label).slice(0, 56);
            let value = base;
            let n = 2;
            while (used.has(value)) value = `${base}_${n++}`;
            used.add(value);
            return { value, label, color: colorForOption(label, i), aliases: forms.slice(0, 10) };
        });
}

/** Las opciones que propone una columna cuando se elige un tipo con opciones (sin las filas: desde el perfil). */
export function optionsFromProfile(col: FileImportColumnProfile, type: 'select' | 'multi_select'): FileImportOption[] {
    if (type === 'multi_select') {
        if (col.token_top && col.token_top.length > 0) return buildOptionsWeighted(col.token_top);
        return buildOptionsWeighted((col.top ?? []).flatMap((t) => t.value.split(/[,;\n]/).map((v) => ({ value: v, count: t.count }))));
    }
    return buildOptionsWeighted(col.top ?? []);
}

// ── Campos ────────────────────────────────────────────────────────────────

function currencyOf(samples: readonly string[], fallback: string): string {
    const text = samples.join(' ').toLowerCase();
    if (/(us\$|usd)/.test(text)) return 'USD';
    if (/(€|eur)/.test(text)) return 'EUR';
    if (/mxn/.test(text)) return 'MXN';
    if (/(pen|s\/)/.test(text)) return 'PEN';
    if (/clp/.test(text)) return 'CLP';
    if (/ars/.test(text)) return 'ARS';
    if (/£|gbp/.test(text)) return 'GBP';
    if (/cop/.test(text)) return 'COP';
    return fallback;
}

function decimalsOf(samples: readonly string[], numberFormat: string | undefined): number {
    const sep = numberFormat === 'comma_dot' ? '.' : ',';
    let max = 0;
    for (const s of samples) {
        const clean = s.replace(/[^\d.,]/g, '');
        const i = clean.lastIndexOf(sep);
        if (i >= 0) max = Math.max(max, clean.length - i - 1);
    }
    return Math.min(4, max || 2);
}

export function uniqueFieldSlug(label: string, used: Set<string>): string {
    let base = slugify(label).slice(0, 56);
    if (RESERVED_FIELD_SLUGS.includes(base)) base = `${base}_campo`;
    let slug = base;
    let n = 2;
    while (used.has(slug)) slug = `${base}_${n++}`;
    used.add(slug);
    return slug;
}

/** Todos los valores de la columna pasan el formato de documento (sin eso, cada fila mala se perdería). */
function documentFormat(col: FileImportColumnProfile, values: readonly string[]): FileImportField['format'] {
    const hints = headerHints(col.header);
    const candidate = hints.has('nit') ? 'nit' : hints.has('placa') ? 'placa' : hints.has('cedula') ? 'cedula' : null;
    if (candidate === null) return undefined;
    const distinct = [...new Set(values.map((v) => v.trim()).filter((v) => v !== ''))].slice(0, 3000);
    if (distinct.length < 3) return undefined;
    const field = { type: 'text' as const, config: { validation: { format: candidate } } };
    return distinct.every((v) => checkValueRules(field, v) === null) ? candidate : undefined;
}

export function draftField(col: FileImportColumnProfile, values: readonly string[], rowCount: number, used: Set<string>, opts: DraftOptions): FileImportField {
    const label = cleanFieldLabel(col.header);
    const type: FileImportFieldType = col.detected;
    const field: FileImportField = {
        column: col.index,
        include: !col.discard,
        label,
        slug: uniqueFieldSlug(label, used),
        type,
        reason: (col.discard ?? col.reason).slice(0, 240),
        confidence: type === 'select' || type === 'multi_select' ? 'medium' : 'high',
    };
    if (rowCount > 0 && col.filled / rowCount < 0.5 && !col.discard) field.confidence = 'low';
    Object.assign(field, typeExtras(col, values, type, opts));
    return field;
}

/** Lo que cada tipo necesita además del nombre (opciones, moneda, formatos). */
export function typeExtras(col: FileImportColumnProfile, values: readonly string[], type: FileImportFieldType, opts: DraftOptions): Partial<FileImportField> {
    const nonEmpty = values.filter((v) => v.trim() !== '');
    switch (type) {
        case 'select':
        case 'multi_select':
            return { options: nonEmpty.length > 0 ? buildOptions(nonEmpty, type) : optionsFromProfile(col, type) };
        case 'currency':
            return {
                currency: currencyOf(col.samples, opts.currency ?? 'COP'),
                precision: col.numeric?.integers ? 0 : 2,
                number_format: col.number_format,
            };
        case 'number':
            return { precision: col.numeric?.integers ? 0 : decimalsOf(col.samples, col.number_format), number_format: col.number_format };
        case 'percent':
            return { precision: col.numeric?.integers ? 0 : 1, number_format: col.number_format };
        case 'date':
        case 'datetime':
            return { date_order: col.date_order };
        case 'phone':
            return { default_country: opts.country ?? 'CO' };
        case 'text': {
            const out: Partial<FileImportField> = {};
            if (col.shape === 'id' && col.distinct === col.filled && col.filled >= 5) out.is_unique = true;
            const format = col.shape === 'id' ? documentFormat(col, nonEmpty) : undefined;
            if (format) out.format = format;
            return out;
        }
        default:
            return {};
    }
}

// ── La columna que hace de título ─────────────────────────────────────────

export function pickTitleColumn(profile: FileImportSheetProfile): number {
    let best = -1;
    let bestScore = Number.NEGATIVE_INFINITY;
    const rows = Math.max(profile.rows, 1);
    for (const c of profile.columns) {
        if (c.discard || c.filled === 0) continue;
        if (c.detected !== 'text' && c.detected !== 'long_text') continue;
        const hints = headerHints(c.header);
        let score = 0;
        if (hints.has('name')) score += 3;
        score += c.detected === 'text' ? 2 : -2;
        const ratio = c.distinct / Math.max(c.filled, 1);
        if (ratio >= 0.9) score += 4;
        else if (ratio >= 0.6) score += 2;
        else if (ratio < 0.4) score -= 3;
        if (c.filled / rows >= 0.95) score += 1;
        if (c.avg_length >= 3 && c.avg_length <= 60) score += 1;
        if (c.shape === 'id') score -= 1;
        if (c.index <= 2) score += 0.5;
        if (score > bestScore) {
            best = c.index;
            bestScore = score;
        }
    }
    if (best >= 0) return best;
    // Sin una columna de texto: la primera que tenga datos (se convierte a texto).
    const first = profile.columns.find((c) => c.filled > 0 && !c.discard) ?? profile.columns[0];
    return first?.index ?? 0;
}

// ── El borrador completo ──────────────────────────────────────────────────

export function buildDraftPlan(sheets: readonly DraftSheet[], opts: DraftOptions): FileImportPlan {
    const base = fileBaseName(opts.fileName);
    const texts = [opts.fileName, ...sheets.flatMap((s) => [s.profile.name, ...s.profile.headers])];
    const kind = detectDataKind(texts);
    const keys = new Set<string>();
    const uniqueKey = (name: string): string => {
        let k = slugify(name).slice(0, 36) || 'lista';
        if (!/^[a-z]/.test(k)) k = `l_${k}`.slice(0, 36);
        let out = k;
        let n = 2;
        while (keys.has(out)) out = `${k}_${n++}`;
        keys.add(out);
        return out;
    };
    const colValues = (s: DraftSheet, col: number): string[] => s.rows.map((r) => String(r[col] ?? '').trim());

    // 1. Una lista por hoja.
    const lists: FileImportList[] = [];
    const titles = new Map<number, number>();
    sheets.forEach((s, i) => {
        const p = s.profile;
        const sheetName = p.name.trim();
        const name =
            sheets.length === 1
                ? sheetName !== '' && !GENERIC_SHEET.test(sheetName)
                    ? capitalize(sheetName)
                    : base
                : sheetName !== '' && !GENERIC_SHEET.test(sheetName)
                  ? capitalize(sheetName)
                  : `${base} ${i + 1}`;
        const look = sheets.length === 1 ? lookForKind(kind) : (detectDataKind([sheetName, ...p.headers]) !== 'generic' ? lookForKind(detectDataKind([sheetName, ...p.headers])) : lookForName(sheetName));
        const title = pickTitleColumn(p);
        titles.set(p.index, title);
        const used = new Set<string>();
        const fields = p.columns.map((c) => draftField(c, colValues(s, c.index), p.rows, used, opts));
        const tf = fields.find((f) => f.column === title);
        if (tf) {
            if (tf.type !== 'text' && tf.type !== 'long_text') {
                Object.assign(tf, { type: 'text', options: undefined, currency: undefined, precision: undefined, number_format: undefined, date_order: undefined });
                tf.reason = 'Hace de título de cada registro.';
            }
            tf.include = true;
            delete tf.is_unique;
        }
        lists.push({
            sheet: p.index,
            key: uniqueKey(name),
            name: name.slice(0, 80),
            icon: look.icon,
            color: look.color,
            include: p.rows > 0,
            title_column: title,
            skip_duplicates: p.duplicate_rows > 0,
            fields,
        });
    });

    // 2. Vínculos entre hojas: una columna que nombra registros de otra hoja.
    const links: FileImportLink[] = [];
    if (sheets.length > 1) {
        for (const a of sheets) {
            const listA = lists.find((l) => l.sheet === a.profile.index)!;
            for (const c of a.profile.columns) {
                if (c.index === listA.title_column || c.discard) continue;
                if (c.detected !== 'text' && c.detected !== 'select' && c.detected !== 'email') continue;
                let best: { to: string; match: number; sheet: string } | null = null;
                for (const b of sheets) {
                    if (b === a) continue;
                    const listB = lists.find((l) => l.sheet === b.profile.index)!;
                    const titleB = b.profile.columns[listB.title_column];
                    if (!titleB || titleB.distinct < titleB.filled * 0.8) continue;
                    const match = linkMatch(colValues(a, c.index), colValues(b, listB.title_column));
                    const named = fold(listB.name).includes(fold(cleanFieldLabel(c.header)).replace(/s$/, ''));
                    if ((match >= 0.8 || (named && match >= 0.5)) && (!best || match > best.match)) best = { to: listB.key, match, sheet: listB.name };
                }
                if (best && links.length < 10) {
                    links.push({
                        sheet: a.profile.index,
                        column: c.index,
                        to: best.to,
                        include: best.match >= 0.8,
                        match: Math.round(best.match * 100) / 100,
                        reason: `El ${Math.round(best.match * 100)} % de los valores de «${c.header}» son registros de «${best.sheet}».`.slice(0, 240),
                    });
                }
            }
        }
    }

    // 3. Cosas distintas escondidas en una hoja (los clientes de una hoja de facturas).
    const entities: FileImportEntity[] = [];
    for (const s of sheets) {
        const list = lists.find((l) => l.sheet === s.profile.index)!;
        const linked = new Set(links.filter((l) => l.sheet === s.profile.index).map((l) => l.column));
        for (const cand of findEntityCandidates(s.profile, s.rows, list.title_column)) {
            if (linked.has(cand.key_column) || entities.length >= 6) continue;
            const columns = cand.columns.filter((c) => !linked.has(c));
            if (columns.length === 0) continue;
            const keyCol = s.profile.columns[cand.key_column]!;
            const keyField = list.fields.find((f) => f.column === cand.key_column)!;
            const name = pluralName(keyCol.header);
            const look = lookForName(name);
            const depCols = columns.map((c) => s.profile.columns[c]!);
            const people = /(cliente|contacto|proveedor|empresa|paciente|alumno|estudiante|candidato|socio|asociado|afiliado)/.test(fold(keyCol.header));
            const contact = depCols.some((c) => c.detected === 'email' || c.detected === 'phone');
            const depNames = depCols.slice(0, 4).map((c) => `«${c.header}»`).join(', ');
            entities.push({
                key: uniqueKey(name),
                name,
                icon: look.icon,
                color: look.color,
                sheet: s.profile.index,
                key_column: cand.key_column,
                columns,
                include: people || contact,
                link_label: cleanFieldLabel(keyCol.header),
                link_slug: keyField.slug,
                records: cand.distinct,
                reason: `«${keyCol.header}» se repite (${cand.distinct} distintos) y siempre trae los mismos datos (${depNames}): conviene una lista de ${name} aparte, vinculada.`.slice(0, 240),
            });
        }
    }
    // Más listas que el máximo: las separaciones sugeridas quedan apagadas.
    let total = lists.filter((l) => l.include).length;
    for (const e of entities) {
        if (!e.include) continue;
        if (total >= FILE_IMPORT_MAX_LISTS) e.include = false;
        else total++;
    }

    const plan: FileImportPlan = {
        version: 1,
        kind,
        summary: draftSummary(sheets, lists, entities, kind),
        ai_used: false,
        lists,
        entities,
        links,
    };
    if (total > 1) plan.folder_name = base;
    return plan;
}

function draftSummary(sheets: readonly DraftSheet[], lists: readonly FileImportList[], entities: readonly FileImportEntity[], kind: FileImportDataKind): string {
    const rows = sheets.reduce((n, s) => n + s.profile.rows, 0);
    const fields = lists.reduce((n, l) => n + l.fields.filter((f) => f.include).length, 0);
    const dropped = lists.reduce((n, l) => n + l.fields.filter((f) => !f.include).length, 0);
    const parts = [
        sheets.length === 1 ? `${rows} filas con ${sheets[0]!.profile.headers.length} columnas` : `${sheets.length} hojas con ${rows} filas en total`,
        kind !== 'generic' ? `parecen ${FILE_IMPORT_DATA_KIND_LABELS[kind].toLocaleLowerCase('es')}` : null,
        `${fields} campos${dropped > 0 ? ` y ${dropped} columnas para descartar` : ''}`,
        entities.some((e) => e.include) ? `${entities.filter((e) => e.include).map((e) => e.name).join(' y ')} en su propia lista` : null,
    ].filter((p): p is string => p !== null);
    return `${capitalize(parts.join('; '))}.`.slice(0, 400);
}
