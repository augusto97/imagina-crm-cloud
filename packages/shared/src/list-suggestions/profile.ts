import type { FieldType } from '../schemas/field';
import { foldSearchText } from '../field-types/search';

/**
 * v0.1.341 (ADR-S89) — El PERFIL de una lista: qué campos tiene y cómo se
 * usan (cuántos registros los llenan, cuántos valores distintos, cuántos
 * vencidos…), calculado sobre una muestra de los registros más recientes.
 * Es la entrada de las reglas gratuitas y, ENMASCARADO (`profileForAi`), de
 * la IA. Puro: el servidor lee las filas con el ACL de quien mira y llama acá.
 */

export interface SuggestFieldInput {
    id: number;
    slug: string;
    label: string;
    type: FieldType;
    required?: boolean;
    unique?: boolean;
    options?: ReadonlyArray<{ value: string; label: string }>;
    /** Relación: la lista del otro lado. */
    relation?: { slug: string; name: string } | null;
    created_at?: string | null;
}

export interface SuggestRowInput {
    data: Record<string, unknown>;
    created_at: string | Date;
    updated_at: string | Date;
}

export interface FieldProfile {
    id: number;
    slug: string;
    label: string;
    type: FieldType;
    required: boolean;
    unique: boolean;
    /** Registros de la muestra con valor. */
    filled: number;
    /** Valores distintos (texto, correo, teléfono, persona, selección). */
    distinct: number | null;
    /** Selección: cuántos registros en cada opción (en el orden del campo). */
    options?: Array<{ value: string; label: string; count: number }>;
    /** Texto: los valores más repetidos (SÓLO para el servidor y quien mira; nunca viajan a la IA). */
    top?: Array<{ value: string; count: number }>;
    /**
     * Texto y texto largo: algunos valores distintos, de los registros más
     * recientes, CRUDOS. Sólo viajan a la IA si quien analiza marca «Incluir
     * ejemplos de texto», y entonces enmascarados (`maskTextExample`).
     */
    examples?: string[];
    /** Valores repetidos: cuántos valores aparecen más de una vez y en cuántos registros. */
    dupes?: { values: number; records: number; top: string | null; top_count: number };
    num?: { min: number; max: number; avg: number; sum: number };
    /** Fechas (AAAA-MM-DD): rango, cuántas ya pasaron, cuántas en los próximos 30 días y cuántas vencidas sin cerrar. */
    date?: { min: string; max: string; past: number; next30: number; past_open: number };
    trues?: number;
    relation?: { slug: string; name: string } | null;
    created_at: string | null;
}

export interface ListStatusInfo {
    fieldId: number;
    /** Valores de las opciones que significan «terminado» (pagada, cerrado, ganado…). */
    doneValues: string[];
}

export interface ListProfile {
    list: { id: number; slug: string; name: string; title_field_id: number | null };
    /** Registros de primer nivel que ve quien mira. */
    total: number;
    /** Registros de la muestra (los más recientes). */
    sampled: number;
    created_30d: number;
    updated_30d: number;
    today: string;
    status: ListStatusInfo | null;
    fields: FieldProfile[];
    views: Array<{
        name: string;
        type: string;
        group_by_field_id: number | null;
        date_field_id: number | null;
        start_field_id: number | null;
        end_field_id: number | null;
        person_field_id: number | null;
        filter_field_ids: number[];
    }>;
    automations: Array<{ name: string; trigger_type: string; action_types: string[]; active: boolean }>;
    /** Tableros con algún widget sobre esta lista. */
    dashboards: Array<{ name: string }>;
    forms: number;
    portal_enabled: boolean;
    /** Lista espejo de una tienda o un sitio: los campos no se convierten. */
    mirror: boolean;
    /** Listas vinculadas (en los dos sentidos). */
    linked: Array<{ slug: string; name: string; direction: 'out' | 'in'; via: string; fields: Array<{ slug: string; label: string; type: FieldType }> }>;
}

/** Tipos cuyo valor vive en `records.data` (los demás se calculan al leer). */
export const PROFILED_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
    'text',
    'long_text',
    'number',
    'currency',
    'select',
    'multi_select',
    'date',
    'datetime',
    'checkbox',
    'url',
    'email',
    'user',
    'file',
    'phone',
    'rating',
    'percent',
    'duration',
    'ai',
    'autonumber',
]);

const TEXTY: ReadonlySet<FieldType> = new Set<FieldType>(['text', 'long_text', 'email', 'phone', 'url', 'autonumber', 'ai']);
const NUMERIC: ReadonlySet<FieldType> = new Set<FieldType>(['number', 'currency', 'percent', 'rating', 'duration']);

/** Plegado para comparar etiquetas: minúsculas y sin acentos. */
export const foldLabel = (s: string): string => foldSearchText(s).trim();

const STATUS_RE = /(estado|etapa|status|fase|pipeline|situacion|progreso)/;
export const DONE_RE =
    /(termin|complet|hech|cerrad|ganad|pagad|resuelt|entregad|finaliz|aprobad|cancelad|perdid|descartad|rechazad|archivad|^listo|^lista$|done|closed|won|lost|paid|resolved|cancel)/;

/**
 * El campo de ESTADO de la lista: una selección con al menos dos opciones,
 * primero la que se llama como un estado («Estado», «Etapa»…). Sus opciones
 * «terminadas» sirven para contar lo vencido sin cerrar.
 */
export function detectStatusField(fields: ReadonlyArray<SuggestFieldInput>): ListStatusInfo | null {
    const selects = fields.filter((f) => f.type === 'select' && (f.options?.length ?? 0) >= 2);
    const named = selects.find((f) => STATUS_RE.test(foldLabel(f.label)));
    const pick = named ?? selects[0];
    if (!pick) return null;
    const doneValues = (pick.options ?? []).filter((o) => DONE_RE.test(foldLabel(o.label)) || DONE_RE.test(foldLabel(o.value))).map((o) => o.value);
    return { fieldId: pick.id, doneValues };
}

function isEmpty(v: unknown): boolean {
    return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function ymdOf(v: unknown): string | null {
    if (typeof v !== 'string') return null;
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
    return m ? m[1]! : null;
}

function addDays(ymd: string, n: number): string {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
}

function toNumber(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
}

function textKey(type: FieldType, v: unknown): string | null {
    if (typeof v !== 'string' && typeof v !== 'number') return null;
    const s = String(v).trim();
    if (s === '') return null;
    if (type === 'phone') return s.replace(/[^\d+]/g, '');
    if (type === 'email' || type === 'url') return s.toLowerCase();
    return s.replace(/\s+/g, ' ').toLowerCase();
}

function stamp(v: string | Date): number {
    return typeof v === 'string' ? Date.parse(v) : v.getTime();
}

/**
 * Calcula el perfil a partir de las filas de la muestra. `rows` vienen de lo
 * que quien mira puede ver, y `fields` sin sus campos ocultos.
 */
export function profileListRecords(
    fields: ReadonlyArray<SuggestFieldInput>,
    rows: ReadonlyArray<SuggestRowInput>,
    opts: { today: string; now?: Date },
): { fields: FieldProfile[]; status: ListStatusInfo | null; created_30d: number; updated_30d: number } {
    const status = detectStatusField(fields);
    const done = new Set(status?.doneValues ?? []);
    const now = (opts.now ?? new Date()).getTime();
    const monthAgo = now - 30 * 86_400_000;
    const in30 = addDays(opts.today, 29);
    let created30 = 0;
    let updated30 = 0;
    for (const r of rows) {
        if (stamp(r.created_at) >= monthAgo) created30++;
        if (stamp(r.updated_at) >= monthAgo) updated30++;
    }

    const out: FieldProfile[] = [];
    for (const f of fields) {
        const key = `f${f.id}`;
        const p: FieldProfile = {
            id: f.id,
            slug: f.slug,
            label: f.label,
            type: f.type,
            required: f.required === true,
            unique: f.unique === true,
            filled: 0,
            distinct: null,
            relation: f.relation ?? null,
            created_at: f.created_at ?? null,
        };
        if (!PROFILED_TYPES.has(f.type)) {
            out.push(p);
            continue;
        }
        const counts = new Map<string, number>();
        const display = new Map<string, string>();
        const examples: string[] = [];
        const seenExample = new Set<string>();
        let min = Infinity;
        let max = -Infinity;
        let sum = 0;
        let nums = 0;
        let dmin: string | null = null;
        let dmax: string | null = null;
        let past = 0;
        let next30 = 0;
        let pastOpen = 0;
        let trues = 0;
        for (const r of rows) {
            const v = r.data[key];
            if (f.type === 'checkbox') {
                if (v === true) {
                    trues++;
                    p.filled++;
                } else if (v === false) p.filled++;
                continue;
            }
            if (isEmpty(v)) continue;
            p.filled++;
            if (TEXTY.has(f.type)) {
                const k = textKey(f.type, v);
                if (k === null) continue;
                counts.set(k, (counts.get(k) ?? 0) + 1);
                if (!display.has(k)) display.set(k, String(v).trim().slice(0, 80));
                if (EXAMPLE_TYPES.has(f.type) && examples.length < MAX_RAW_EXAMPLES && !seenExample.has(k)) {
                    seenExample.add(k);
                    examples.push(String(v).trim().slice(0, 400));
                }
            } else if (f.type === 'select') {
                const k = String(v);
                counts.set(k, (counts.get(k) ?? 0) + 1);
            } else if (f.type === 'multi_select' && Array.isArray(v)) {
                for (const item of v) counts.set(String(item), (counts.get(String(item)) ?? 0) + 1);
            } else if (f.type === 'user') {
                const k = String(v);
                counts.set(k, (counts.get(k) ?? 0) + 1);
            } else if (NUMERIC.has(f.type)) {
                const n = toNumber(v);
                if (n === null) continue;
                nums++;
                sum += n;
                if (n < min) min = n;
                if (n > max) max = n;
            } else if (f.type === 'date' || f.type === 'datetime') {
                const d = ymdOf(v);
                if (!d) continue;
                if (dmin === null || d < dmin) dmin = d;
                if (dmax === null || d > dmax) dmax = d;
                if (d < opts.today) {
                    past++;
                    const st = status ? r.data[`f${status.fieldId}`] : undefined;
                    if (!status || !done.has(String(st ?? ''))) pastOpen++;
                } else if (d <= in30) next30++;
            }
        }
        if (TEXTY.has(f.type) || f.type === 'user' || f.type === 'select') p.distinct = counts.size;
        if (f.type === 'select' || f.type === 'multi_select') {
            const known = new Set((f.options ?? []).map((o) => o.value));
            p.options = (f.options ?? []).map((o) => ({ value: o.value, label: o.label, count: counts.get(o.value) ?? 0 }));
            const others = [...counts.entries()].filter(([k]) => !known.has(k)).reduce((n, [, c]) => n + c, 0);
            if (others > 0) p.options.push({ value: '', label: '(otros)', count: others });
        }
        if (TEXTY.has(f.type) && counts.size > 0) {
            const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
            p.top = sorted.slice(0, 5).map(([k, c]) => ({ value: display.get(k) ?? k, count: c }));
            const repeated = sorted.filter(([, c]) => c > 1);
            if (repeated.length > 0) {
                const [topKey, topCount] = repeated[0]!;
                p.dupes = {
                    values: repeated.length,
                    records: repeated.reduce((n, [, c]) => n + c, 0),
                    top: display.get(topKey) ?? topKey,
                    top_count: topCount,
                };
            }
        }
        if (examples.length > 0) p.examples = examples;
        if (NUMERIC.has(f.type) && nums > 0) p.num = { min, max, avg: Math.round((sum / nums) * 100) / 100, sum: Math.round(sum * 100) / 100 };
        if ((f.type === 'date' || f.type === 'datetime') && dmin && dmax) p.date = { min: dmin, max: dmax, past, next30, past_open: pastOpen };
        if (f.type === 'checkbox') p.trues = trues;
        out.push(p);
    }
    return { fields: out, status, created_30d: created30, updated_30d: updated30 };
}

/** Tipos de los que se toman ejemplos de texto (los demás ya viajan como estructura o nunca viajan). */
const EXAMPLE_TYPES: ReadonlySet<FieldType> = new Set<FieldType>(['text', 'long_text']);
/** Valores crudos que se guardan por campo en el perfil (del servidor). */
const MAX_RAW_EXAMPLES = 8;
/** Ejemplos por campo y campos con ejemplos que viajan a la IA. */
export const AI_EXAMPLES_PER_FIELD = 5;
export const AI_EXAMPLE_FIELDS_MAX = 12;

/**
 * Campos que por su NOMBRE guardan datos de una persona o de una empresa
 * (nombre, documento, dirección, contacto…): de esos no viaja ningún ejemplo,
 * ni siquiera enmascarado.
 */
const PERSONAL_FIELD_RE =
    /(nombre|apellido|razon social|cliente|contacto|persona|responsable|titular|paciente|alumno|estudiante|candidato|proveedor|empleado|usuario|empresa|cedula|documento|identificacion|\bnit\b|\bdni\b|\brut\b|\bcuit\b|\brfc\b|\bcurp\b|pasaporte|direccion|domicilio|address|telefono|celular|movil|whatsapp|correo|e-?mail|cuenta|iban|tarjeta|placa|firma)/;

export function isPersonalTextField(label: string): boolean {
    return PERSONAL_FIELD_RE.test(foldLabel(label));
}

/**
 * Un ejemplo de texto con los datos personales tapados: correos, enlaces,
 * cualquier número de 6 dígitos o más (documentos, teléfonos, cuentas,
 * fechas) y los nombres propios (dos o más palabras seguidas con mayúscula:
 * «Juan Pérez», «Acme Andina»). Lo que queda es el tipo de texto que guarda
 * el campo («Renovación de [web] por 12 meses»), que es lo que la IA necesita
 * para entender de qué trata la lista. Se corta a `max` caracteres.
 */
export function maskTextExample(value: string, max = 80): string {
    let v = value.replace(/\s+/g, ' ').trim();
    v = v.replace(/[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]{2,}/g, '[correo]');
    v = v.replace(/\b(?:https?:\/\/|www\.)\S+/gi, '[web]');
    v = v.replace(/\+?\d[\d\s().\-/]*\d/g, (m) => (m.replace(/\D/g, '').length >= 6 ? '[número]' : m));
    v = v.replace(/(?<![\p{L}\p{N}])\p{Lu}[\p{L}'’]+(?:[ \t]+(?:(?:de|del|la|las|los|y|da|dos|van|von)[ \t]+)*\p{Lu}[\p{L}'’]+)+/gu, '[nombre]');
    const chars = Array.from(v);
    return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : v;
}

/**
 * Lo que viaja a la IA: la estructura y los números, NUNCA valores de texto,
 * correos, teléfonos ni personas (sólo cuántos hay). Las etiquetas de las
 * opciones de una selección sí viajan: son parte de la estructura de la lista.
 * Con `examples: true` (la casilla «Incluir ejemplos de texto»), los campos
 * de texto suman hasta 5 ejemplos ENMASCARADOS (`maskTextExample`), salvo los
 * que por su nombre guardan datos de una persona o empresa.
 */
export function profileForAi(profile: ListProfile, extras: { purpose?: string | null; examples?: boolean } = {}): Record<string, unknown> {
    const pct = (n: number): number => (profile.sampled > 0 ? Math.round((n / profile.sampled) * 100) : 0);
    let exampleFields = 0;
    const examplesFor = (f: FieldProfile): string[] | null => {
        if (!extras.examples || !EXAMPLE_TYPES.has(f.type) || !f.examples?.length) return null;
        if (isPersonalTextField(f.label) || exampleFields >= AI_EXAMPLE_FIELDS_MAX) return null;
        const max = f.type === 'long_text' ? 140 : 80;
        const out = [...new Set(f.examples.map((e) => maskTextExample(e, max)))].filter((e) => e !== '').slice(0, AI_EXAMPLES_PER_FIELD);
        if (out.length === 0) return null;
        exampleFields++;
        return out;
    };
    return {
        lista: { slug: profile.list.slug, nombre: profile.list.name },
        para_que_se_usa: extras.purpose?.trim() || null,
        hoy: profile.today,
        registros: profile.total,
        muestra: profile.sampled,
        creados_ultimos_30_dias: profile.created_30d,
        cambiados_ultimos_30_dias: profile.updated_30d,
        campo_de_estado: profile.status ? profile.fields.find((f) => f.id === profile.status!.fieldId)?.slug ?? null : null,
        campos: profile.fields.map((f) => {
            const base: Record<string, unknown> = {
                slug: f.slug,
                nombre: f.label,
                tipo: f.type,
                ...(f.required ? { obligatorio: true } : {}),
                ...(f.unique ? { sin_repetidos: true } : {}),
            };
            if (PROFILED_TYPES.has(f.type)) base.lleno_pct = pct(f.filled);
            if (f.distinct !== null && f.type !== 'select') base.valores_distintos = f.distinct;
            if (f.options) base.opciones = f.options.map((o) => ({ value: o.value, etiqueta: o.label, registros: o.count }));
            if (f.dupes && (f.type === 'email' || f.type === 'phone' || f.type === 'text')) base.valores_repetidos = f.dupes.values;
            if (f.num) base.numeros = f.num;
            if (f.date) base.fechas = { desde: f.date.min, hasta: f.date.max, pasadas: f.date.past, proximos_30_dias: f.date.next30, vencidas_sin_cerrar: f.date.past_open };
            if (f.trues !== undefined) base.marcadas = f.trues;
            if (f.relation) base.vinculada_a = f.relation.slug;
            const ex = examplesFor(f);
            if (ex) base.ejemplos = ex;
            return base;
        }),
        vistas: profile.views.map((v) => ({ nombre: v.name, tipo: v.type })),
        automatizaciones: profile.automations.map((a) => ({ nombre: a.name, disparador: a.trigger_type, acciones: a.action_types, activa: a.active })),
        tableros: profile.dashboards.map((d) => d.name),
        formularios: profile.forms,
        portal_del_cliente: profile.portal_enabled,
        listas_vinculadas: profile.linked.map((l) => ({
            slug: l.slug,
            nombre: l.name,
            sentido: l.direction === 'out' ? 'esta lista apunta a esa' : 'esa lista apunta a esta',
            por: l.via,
            campos: l.fields.slice(0, 30),
        })),
    };
}

/** FNV-1a de 32 bits, en hex: huella estable y barata (no es criptográfica). */
export function hashString(s: string): string {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

/**
 * Huella de la lista para la IA: cambia cuando cambian los campos, las vistas,
 * las automatizaciones o los tableros, cuando la cantidad de registros cambia
 * de orden de magnitud, o cuando se cuenta otro propósito. Con la misma huella
 * (y antes de 30 días) volver a analizar no tiene sentido: saldría lo mismo.
 */
export function listFingerprint(profile: ListProfile, purpose?: string | null, examples = false): string {
    const parts = [
        profile.fields.map((f) => `${f.id}:${f.type}:${f.options?.length ?? 0}`).join(','),
        profile.views.map((v) => `${v.type}:${v.group_by_field_id ?? ''}:${v.date_field_id ?? ''}`).sort().join(','),
        String(profile.automations.length),
        String(profile.dashboards.length),
        String(profile.forms),
        String(Math.floor(Math.log2(profile.total + 1))),
        foldLabel(purpose ?? ''),
        examples ? 'ejemplos' : '',
    ];
    return hashString(parts.join('|'));
}
