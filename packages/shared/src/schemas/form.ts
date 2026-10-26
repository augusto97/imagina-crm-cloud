import { z } from 'zod';
import type { PublicDataConsent } from './data-consent';
import type { FieldType } from './field';

/**
 * v0.1.275 — Formularios públicos (ADR-S39).
 *
 * Un formulario es una puerta de ENTRADA a una lista: quien lo completa
 * (sin cuenta) crea un registro. Vive en su propia tabla (`forms`, RLS) y
 * se publica por un token opaco, igual que la lista pública de ADR-S14 —
 * pero al revés: aquélla deja LEER, éste deja ESCRIBIR, y sólo los campos
 * que el formulario pregunta.
 *
 * El diseño se guarda como `config` = ítems ordenados + ajustes. Cada ítem
 * de campo apunta al campo por ID (regla de oro nº 1): renombrar el campo
 * o cambiarle el slug no rompe el formulario.
 */

/** Tipos de campo que un formulario puede preguntar. */
export const FORM_FIELD_TYPES = [
    'text',
    'long_text',
    'number',
    'currency',
    'select',
    'multi_select',
    'date',
    'datetime',
    'checkbox',
    'email',
    'url',
    'phone',
    'rating',
    'percent',
    'duration',
    'file',
    // C1 — «¿A qué área va tu consulta?»: se elige entre los equipos.
    'team',
] as const satisfies readonly FieldType[];
export type FormFieldType = (typeof FORM_FIELD_TYPES)[number];

const FORM_TYPE_SET = new Set<string>(FORM_FIELD_TYPES);
/**
 * ¿Este tipo de campo se puede preguntar en un formulario? Quedan afuera los
 * que no escribe una persona (calculados, lookup, rollup), las personas del
 * equipo (`user`: el visitante no conoce a nadie) y las relaciones (exponer
 * los registros de otra lista a cualquiera con el enlace sería una fuga).
 */
export function isFormFieldType(type: string): type is FormFieldType {
    return FORM_TYPE_SET.has(type);
}

export const FORM_CONDITION_OPS = [
    'eq',
    'neq',
    'in',
    'contains',
    'gt',
    'lt',
    'is_empty',
    'is_not_empty',
] as const;
export type FormConditionOp = (typeof FORM_CONDITION_OPS)[number];

/**
 * «Mostrar sólo si…»: depende de la respuesta a OTRO campo del formulario.
 * Una sola condición por ítem a propósito — la lógica que se arma con un
 * clic es la que la gente entiende; un árbol AND/OR aquí sería un editor de
 * filtros para personas que sólo quieren «si eligió Empresa, pedir el NIT».
 */
export const formConditionSchema = z.object({
    field_id: z.number().int().positive(),
    op: z.enum(FORM_CONDITION_OPS),
    value: z.unknown().optional(),
});
export type FormCondition = z.infer<typeof formConditionSchema>;

const itemIdSchema = z.string().regex(/^[a-z0-9]{4,24}$/);

/**
 * Qué archivos acepta una pregunta de archivos. Sea cual sea la elección,
 * los ejecutables y lo que un navegador interpretaría como página (`.exe`,
 * `.html`, `.svg`, scripts…) se rechazan siempre: un formulario público es
 * una puerta abierta a cualquiera.
 */
export const FORM_FILE_ACCEPTS = ['any', 'images', 'pdf', 'images_pdf', 'documents'] as const;
export type FormFileAccept = (typeof FORM_FILE_ACCEPTS)[number];

const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'avif', 'bmp'];
const DOC_EXTS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'txt', 'csv', 'rtf'];

export const FORM_FILE_ACCEPT_INFO: Record<FormFileAccept, { label: string; extensions: readonly string[] | null }> = {
    any: { label: 'Cualquier archivo (salvo programas)', extensions: null },
    images: { label: 'Imágenes', extensions: IMAGE_EXTS },
    pdf: { label: 'PDF', extensions: ['pdf'] },
    images_pdf: { label: 'Imágenes o PDF', extensions: [...IMAGE_EXTS, 'pdf'] },
    documents: { label: 'Documentos (PDF, Word, Excel, texto)', extensions: DOC_EXTS },
};

/** Extensiones que un formulario público nunca recibe. */
export const FORM_BLOCKED_EXTENSIONS: readonly string[] = [
    'exe', 'msi', 'msp', 'mst', 'bat', 'cmd', 'com', 'scr', 'pif', 'cpl', 'dll', 'sys', 'drv', 'ocx',
    'ps1', 'psm1', 'vbs', 'vbe', 'js', 'mjs', 'jse', 'wsf', 'wsh', 'hta', 'jar', 'class', 'apk', 'aab',
    'app', 'dmg', 'pkg', 'deb', 'rpm', 'sh', 'bash', 'zsh', 'csh', 'ksh', 'run', 'bin', 'so', 'dylib',
    'lnk', 'reg', 'gadget', 'inf', 'iso', 'img', 'vhd', 'vhdx', 'html', 'htm', 'xhtml', 'shtml', 'svg',
    'svgz', 'php', 'phtml', 'asp', 'aspx', 'jsp', 'cgi', 'pl', 'py', 'rb', 'xap', 'appx', 'msix',
];

const BLOCKED_MIME = /(x-msdownload|x-msdos-program|x-executable|x-sh|x-shellscript|javascript|ecmascript|html|svg|x-php|java-archive|vnd\.android\.package-archive|x-apple-diskimage)/i;

function extensionOf(filename: string): string {
    const base = filename.trim().toLowerCase().split(/[\\/]/).pop() ?? '';
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot + 1) : '';
}

/** ¿Este archivo entra en esta pregunta? (por extensión y tipo declarado). */
export function formFileAllowed(accept: FormFileAccept, filename: string, mime: string): { ok: true } | { ok: false; reason: string } {
    const ext = extensionOf(filename);
    if (FORM_BLOCKED_EXTENSIONS.includes(ext) || BLOCKED_MIME.test(mime)) {
        return { ok: false, reason: 'Ese tipo de archivo no se puede enviar por un formulario.' };
    }
    const allowed = FORM_FILE_ACCEPT_INFO[accept].extensions;
    if (allowed && !allowed.includes(ext)) {
        return { ok: false, reason: `Este campo sólo acepta: ${FORM_FILE_ACCEPT_INFO[accept].label}.` };
    }
    return { ok: true };
}

/** Atributo `accept` del selector de archivos (vacío = cualquiera). */
export function formAcceptAttribute(accept: FormFileAccept): string {
    const exts = FORM_FILE_ACCEPT_INFO[accept].extensions;
    return exts ? exts.map((e) => `.${e}`).join(',') : '';
}

export const formFieldItemSchema = z.object({
    id: itemIdSchema,
    type: z.literal('field'),
    field_id: z.number().int().positive(),
    /** Pregunta que ve el visitante; vacío = la etiqueta del campo. */
    label: z.string().max(300).default(''),
    help: z.string().max(1000).default(''),
    placeholder: z.string().max(200).default(''),
    /** Obligatorio en ESTE formulario (aunque el campo no lo sea en la lista). */
    required: z.boolean().default(false),
    /**
     * Campo oculto: no se muestra, sólo se completa por la dirección
     * (`?origen=instagram`). Para saber de dónde llegó cada respuesta.
     */
    hidden: z.boolean().default(false),
    /** Selección: botones de opción, lista desplegable o casillas. */
    display: z.enum(['auto', 'radio', 'dropdown']).default('auto'),
    /** Archivos: qué tipos acepta esta pregunta. */
    accept: z.enum(FORM_FILE_ACCEPTS).default('any'),
    show_if: formConditionSchema.nullable().default(null),
});
export type FormFieldItem = z.infer<typeof formFieldItemSchema>;

export const formHeadingItemSchema = z.object({
    id: itemIdSchema,
    type: z.literal('heading'),
    text: z.string().max(300).default(''),
    show_if: formConditionSchema.nullable().default(null),
});

export const formTextItemSchema = z.object({
    id: itemIdSchema,
    type: z.literal('text'),
    text: z.string().max(5000).default(''),
    show_if: formConditionSchema.nullable().default(null),
});

/**
 * v0.1.289 — Salto de página: lo que viene después se muestra en un paso
 * aparte («Paso 2 de 4»). No tiene condición propia: una página cuyas
 * preguntas están todas escondidas se salta sola. `show_if` existe sólo para
 * que todos los ítems compartan la forma (siempre `null`).
 */
export const formPageBreakItemSchema = z.object({
    id: itemIdSchema,
    type: z.literal('page_break'),
    /** Título de la página que EMPIEZA aquí (opcional). */
    title: z.string().max(200).default(''),
    show_if: formConditionSchema.nullable().default(null),
});
export type FormPageBreakItem = z.infer<typeof formPageBreakItemSchema>;

export const formItemSchema = z.discriminatedUnion('type', [
    formFieldItemSchema,
    formHeadingItemSchema,
    formTextItemSchema,
    formPageBreakItemSchema,
]);
export type FormItem = z.infer<typeof formItemSchema>;

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const formSettingsSchema = z.object({
    title: z.string().max(200).default(''),
    description: z.string().max(5000).default(''),
    submit_label: z.string().max(60).default('Enviar'),
    success_title: z.string().max(200).default('¡Gracias!'),
    success_message: z.string().max(2000).default('Recibimos tu respuesta.'),
    /** Al enviar, llevar a esta dirección (https) en vez del mensaje. */
    redirect_url: z
        .string()
        .max(2000)
        .regex(/^https:\/\/[^\s]+$/, 'La dirección tiene que empezar con https://')
        .nullable()
        .default(null),
    /** Botón «Enviar otra respuesta» en la pantalla de gracias. */
    allow_another: z.boolean().default(true),
    /** Completar campos desde la dirección: `?nombre=Ana&origen=web`. */
    allow_prefill: z.boolean().default(true),
    /** Sitios que pueden insertarlo por iframe; vacío = cualquiera. */
    allowed_domains: z.array(z.string().max(253)).max(50).default([]),
    /** Color del botón y los detalles; null = el color de la marca. */
    accent_color: hexColor.nullable().default(null),
    show_logo: z.boolean().default(true),
    /** Deja de recibir respuestas después de este día (inclusive). */
    closes_at: isoDate.nullable().default(null),
    /** Deja de recibir respuestas al llegar a este número. */
    max_submissions: z.number().int().min(1).max(1_000_000).nullable().default(null),
    closed_message: z.string().max(1000).default('Este formulario ya no está recibiendo respuestas.'),
    /**
     * v0.1.289 — Pedir verificación anti-robots (captcha). El proveedor y las
     * llaves NO viven aquí: salen de la empresa o, si no tiene, de la
     * plataforma (`resolveCaptcha`). Sin llaves en ningún lado, no se pide.
     */
    captcha: z.boolean().default(false),
    /**
     * v0.1.289 — La pregunta de tipo email con el correo de quien responde
     * (para confirmar el correo y para mandarle la copia). Id del CAMPO.
     */
    respondent_email_field_id: z.number().int().positive().nullable().default(null),
    /**
     * Doble opt-in: la respuesta queda PENDIENTE hasta que la persona abre el
     * enlace que le llega al correo; recién ahí se crea el registro.
     */
    confirm_email: z.boolean().default(false),
    /** Mandarle a quien responde una copia de sus respuestas. */
    send_copy: z.boolean().default(false),
    /**
     * Pedir la autorización de tratamiento de datos personales (Ley 1581) con
     * el texto de la empresa (Ajustes → Datos personales). Encendida por
     * defecto: apenas la empresa activa su texto, todos sus formularios la
     * piden; se apaga por formulario (p. ej. uno que no recoge datos
     * personales). Sin texto activo en la empresa no se pide.
     */
    data_consent: z.boolean().default(true),
    /**
     * C6 — El registro que crea el formulario sale de esta plantilla de
     * registro de la lista (valores, subtareas y checklists). Lo que el
     * formulario completa PISA lo de la plantilla. null = alta normal.
     */
    record_template_id: z.number().int().positive().nullable().default(null),
});
export type FormSettings = z.infer<typeof formSettingsSchema>;

export const FORM_MAX_ITEMS = 120;

export const formConfigSchema = z.object({
    items: z.array(formItemSchema).max(FORM_MAX_ITEMS).default([]),
    settings: formSettingsSchema.default({}),
});
export type FormConfig = z.infer<typeof formConfigSchema>;

export interface FormDto {
    id: number;
    list_id: number;
    name: string;
    enabled: boolean;
    config: FormConfig;
    /** Dirección pública relativa (`/api/v1/public/f/:token`), con o sin publicar. */
    public_path: string;
    /**
     * La dirección ABSOLUTA para compartir e insertar: por el dominio propio
     * de la empresa si lo tiene y responde (si no, el de la plataforma).
     */
    public_url?: string;
    /** El origen de esa dirección (para el script que ajusta el alto al insertarlo). */
    public_origin?: string;
    submissions_count: number;
    last_submitted_at: string | null;
    created_at: string;
    updated_at: string;
}

export const createFormSchema = z.object({
    name: z.string().trim().min(1).max(120),
    config: formConfigSchema.optional(),
});
export type CreateFormInput = z.infer<typeof createFormSchema>;

export const updateFormSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    enabled: z.boolean().optional(),
    config: formConfigSchema.optional(),
    /** Emite una dirección nueva: la anterior deja de funcionar. */
    regenerate_token: z.boolean().optional(),
});
export type UpdateFormInput = z.infer<typeof updateFormSchema>;

// ─────────────────────────── Público ───────────────────────────

export interface PublicFormOption {
    value: string;
    label: string;
}

/** Lo que el visitante necesita de cada campo — nada de la lista entera. */
export interface PublicFormFieldItem {
    id: string;
    type: 'field';
    /** Clave del valor en el envío: el id del campo como texto. */
    key: string;
    /** Para completar desde la dirección (`?slug=valor`). */
    slug: string;
    field_type: FormFieldType;
    label: string;
    help: string;
    placeholder: string;
    required: boolean;
    hidden: boolean;
    display: 'radio' | 'dropdown' | 'checkboxes';
    options?: PublicFormOption[];
    /** Sólo lo que el control necesita: máximos, decimales, símbolo, país. */
    config: {
        max_files?: number;
        max?: number;
        min?: number;
        precision?: number;
        currency?: string;
        default_country?: string;
        max_length?: number;
        /** Archivos: atributo `accept` del selector y su descripción. */
        accept?: string;
        accept_label?: string;
    };
    show_if: FormCondition | null;
}

export type PublicFormItem =
    | PublicFormFieldItem
    | { id: string; type: 'heading'; text: string; show_if: FormCondition | null }
    | { id: string; type: 'text'; text: string; show_if: FormCondition | null }
    | { id: string; type: 'page_break'; title: string; show_if: null };

/** v0.1.289 — Lo que la página pública necesita para dibujar el captcha. */
export interface PublicFormCaptcha {
    provider: 'turnstile' | 'hcaptcha' | 'recaptcha';
    site_key: string;
}

export interface PublicFormMeta {
    title: string;
    description: string;
    submit_label: string;
    success_title: string;
    success_message: string;
    redirect_url: string | null;
    allow_another: boolean;
    allow_prefill: boolean;
    accent_color: string;
    logo_url: string | null;
    company: string;
    /** Separadores de la empresa para leer «150.000». */
    number_format: 'comma_dot' | 'dot_comma' | 'space_comma';
    items: PublicFormItem[];
    /** null = recibe respuestas; si no, el mensaje de cerrado. */
    closed: string | null;
    /** Sello de carga (anti-robots): el envío tiene que traerlo. */
    stamp: string;
    max_upload_bytes: number;
    /** v0.1.289 — verificación anti-robots a dibujar antes de enviar (null = no se pide). */
    captcha?: PublicFormCaptcha | null;
    /** v0.1.289 — la respuesta se confirma desde el correo (doble opt-in). */
    confirm_email?: boolean;
    /** Autorización de tratamiento de datos a aceptar antes de enviar (null = no se pide). */
    data_consent?: PublicDataConsent | null;
}

export const submitFormSchema = z.object({
    /** Clave = id del campo como texto (`"12"`). */
    values: z.record(z.string().regex(/^\d{1,12}$/), z.unknown()).default({}),
    /** Archivos subidos antes: clave = id del campo, valor = sus comprobantes. */
    uploads: z.record(z.string().regex(/^\d{1,12}$/), z.array(z.string().max(300)).max(20)).default({}),
    stamp: z.string().max(200),
    /** Campo trampa: una persona nunca lo ve ni lo llena. */
    hp: z.string().max(500).optional(),
    /** v0.1.289 — el token del captcha (si el formulario lo pide). */
    captcha: z.string().max(4096).optional(),
    /** Aceptó la autorización de tratamiento de datos (la casilla). */
    consent: z.boolean().optional(),
    /** La versión del texto que se le mostró. */
    consent_version: z.number().int().positive().max(1_000_000).optional(),
});
export type SubmitFormInput = z.infer<typeof submitFormSchema>;

export interface SubmitFormResult {
    ok: true;
    redirect_url: string | null;
    /**
     * v0.1.289 — doble opt-in: la respuesta quedó PENDIENTE y se mandó el
     * correo para confirmarla. `email_hint` = el correo enmascarado.
     */
    pending_confirmation?: boolean;
    email_hint?: string;
}

export interface FormUploadResult {
    token: string;
    name: string;
    size: number;
}

// ─────────────────────────── Lógica pura ───────────────────────────

/** ¿Está vacío este valor como respuesta? (casilla sin marcar cuenta como vacía). */
export function isEmptyAnswer(value: unknown): boolean {
    if (value === null || value === undefined || value === false) return true;
    if (typeof value === 'string') return value.trim() === '';
    if (Array.isArray(value)) return value.length === 0;
    return false;
}

function asNumber(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

/** Evalúa una condición contra la respuesta actual del campo que controla. */
export function evaluateFormCondition(cond: FormCondition, answer: unknown): boolean {
    const empty = isEmptyAnswer(answer);
    switch (cond.op) {
        case 'is_empty':
            return empty;
        case 'is_not_empty':
            return !empty;
        case 'eq':
        case 'neq': {
            let match: boolean;
            if (Array.isArray(answer)) match = answer.map(String).includes(String(cond.value));
            else if (typeof answer === 'boolean') match = answer === (cond.value === true || cond.value === 'true');
            else match = !empty && String(answer).trim().toLowerCase() === String(cond.value ?? '').trim().toLowerCase();
            return cond.op === 'eq' ? match : !match;
        }
        case 'in': {
            const wanted = Array.isArray(cond.value) ? cond.value.map(String) : [];
            if (wanted.length === 0) return false;
            if (Array.isArray(answer)) return answer.some((a) => wanted.includes(String(a)));
            return !empty && wanted.includes(String(answer));
        }
        case 'contains':
            if (empty) return false;
            if (Array.isArray(answer)) return answer.map(String).includes(String(cond.value));
            return String(answer).toLowerCase().includes(String(cond.value ?? '').toLowerCase());
        case 'gt':
        case 'lt': {
            const a = asNumber(answer);
            const b = asNumber(cond.value);
            if (a === null || b === null) return false;
            return cond.op === 'gt' ? a > b : a < b;
        }
        default:
            return false;
    }
}

/**
 * ¿Se muestra este ítem con las respuestas actuales? Un ítem cuyo campo de
 * control está OCULTO (por su propia condición) no se muestra: si no, una
 * respuesta escrita y después escondida seguiría abriendo preguntas.
 * `values` va por id de campo (texto). Las cadenas se cortan a 20 niveles.
 */
export function formItemVisible(
    item: { show_if: FormCondition | null },
    items: ReadonlyArray<{ type: string; field_id?: number; show_if: FormCondition | null }>,
    values: Record<string, unknown>,
    depth = 0,
): boolean {
    const cond = item.show_if;
    if (!cond) return true;
    if (depth > 20) return false;
    const controller = items.find((i) => i.type === 'field' && i.field_id === cond.field_id);
    // Una condición sobre un campo que ya no está en el formulario no se cumple.
    if (!controller) return false;
    if (!formItemVisible(controller, items, values, depth + 1)) return false;
    return evaluateFormCondition(cond, values[String(cond.field_id)]);
}

/** Id corto y estable para un ítem nuevo. */
export function newFormItemId(): string {
    let s = '';
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 10; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

/**
 * Formulario de arranque para una lista: pregunta sus campos escribibles en
 * orden (hasta 12), con los obligatorios de la lista ya marcados. Es un
 * punto de partida — se edita en el constructor.
 */
export function defaultFormConfig(
    listName: string,
    fields: ReadonlyArray<{ id: number; type: string; is_required?: boolean }>,
): FormConfig {
    const askable = fields.filter((f) => isFormFieldType(f.type)).slice(0, 12);
    return formConfigSchema.parse({
        items: askable.map((f) => ({
            id: newFormItemId(),
            type: 'field',
            field_id: f.id,
            required: f.is_required === true,
        })),
        settings: { title: listName },
    });
}

// ─────────────────────── Preguntas públicas ───────────────────────

/** Lo mínimo de un campo que hace falta para armar su pregunta. */
export interface FormFieldLike {
    id: number;
    slug: string;
    label: string;
    type: string;
    config: Record<string, unknown>;
    is_required: boolean;
    description?: string | null;
}

function optionsOf(field: FormFieldLike): PublicFormOption[] {
    const raw = field.config.options;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((o) => {
        if (!o || typeof o !== 'object') return [];
        const { value, label } = o as { value?: unknown; label?: unknown };
        if (typeof value !== 'string') return [];
        return [{ value, label: typeof label === 'string' && label !== '' ? label : value }];
    });
}

function cfgNum(cfg: Record<string, unknown>, key: string): number | undefined {
    const v = cfg[key];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function publicField(item: FormFieldItem, field: FormFieldLike, teamOptions: readonly PublicFormOption[]): PublicFormFieldItem {
    const cfg = field.config;
    const type = field.type as FormFieldType;
    // C1 — un campo «Equipo» se elige entre los equipos de la empresa (sólo
    // viajan su id y su nombre, y sólo si el formulario lo pregunta).
    const options =
        type === 'select' || type === 'multi_select' ? optionsOf(field) : type === 'team' ? [...teamOptions] : undefined;
    const display: PublicFormFieldItem['display'] =
        type === 'multi_select' || (type === 'team' && cfg.multiple === true)
            ? 'checkboxes'
            : item.display === 'radio' || item.display === 'dropdown'
              ? item.display
              : (options?.length ?? 0) <= 6
                ? 'radio'
                : 'dropdown';
    const config: PublicFormFieldItem['config'] = {};
    const max_files = cfgNum(cfg, 'max_files');
    const max = cfgNum(cfg, 'max');
    const min = cfgNum(cfg, 'min');
    const precision = cfgNum(cfg, 'precision');
    const max_length = cfgNum(cfg, 'max_length');
    if (max_files !== undefined) config.max_files = max_files;
    if (max !== undefined) config.max = max;
    if (min !== undefined) config.min = min;
    if (precision !== undefined) config.precision = precision;
    if (max_length !== undefined) config.max_length = max_length;
    if (typeof cfg.currency === 'string') config.currency = cfg.currency;
    if (typeof cfg.default_country === 'string') config.default_country = cfg.default_country;
    if (type === 'file') {
        config.accept = formAcceptAttribute(item.accept);
        config.accept_label = FORM_FILE_ACCEPT_INFO[item.accept].label;
    }
    return {
        id: item.id,
        type: 'field',
        key: String(field.id),
        slug: field.slug,
        field_type: type,
        label: item.label.trim() || field.label,
        help: item.help.trim() || (field.description ?? ''),
        placeholder: item.placeholder,
        required: (item.required || field.is_required) && !item.hidden,
        hidden: item.hidden,
        display,
        ...(options ? { options } : {}),
        config,
        show_if: item.show_if,
    };
}

/**
 * Lo que viaja al visitante: sólo las preguntas, nada del resto de la lista.
 * La usan la página pública Y la vista previa del constructor — lo que se ve
 * al diseñar es, por construcción, lo que ve quien lo completa.
 */
export function buildPublicFormItems(
    config: FormConfig,
    fields: ReadonlyArray<FormFieldLike>,
    /** C1 — los equipos de la empresa (id → nombre) para las preguntas «Equipo». */
    teamOptions: readonly PublicFormOption[] = [],
): PublicFormItem[] {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const out: PublicFormItem[] = [];
    for (const item of config.items) {
        if (item.type === 'heading' || item.type === 'text') {
            out.push({ id: item.id, type: item.type, text: item.text, show_if: item.show_if });
            continue;
        }
        if (item.type === 'page_break') {
            out.push({ id: item.id, type: 'page_break', title: item.title, show_if: null });
            continue;
        }
        const field = byId.get(item.field_id);
        if (!field || !isFormFieldType(field.type)) continue;
        out.push(publicField(item, field, teamOptions));
    }
    return out;
}

// ─────────────────────── Varias páginas (v0.1.289) ───────────────────────

/** Una página del formulario: los ítems entre dos saltos de página. */
export interface FormPage<T> {
    /** Id del salto de página que la abre (null = la primera, antes de cualquier salto). */
    break_id: string | null;
    title: string;
    items: T[];
}

/**
 * Parte los ítems en páginas por los saltos. Un salto al principio, al final
 * o dos seguidos no dejan páginas vacías: una página sin ítems no existe.
 * Sin saltos hay UNA página (el formulario de siempre).
 */
export function splitFormPages<T extends { id: string; type: string; title?: string }>(items: readonly T[]): Array<FormPage<T>> {
    const pages: Array<FormPage<T>> = [];
    let current: FormPage<T> = { break_id: null, title: '', items: [] };
    for (const item of items) {
        if (item.type === 'page_break') {
            if (current.items.length > 0) pages.push(current);
            current = { break_id: item.id, title: typeof item.title === 'string' ? item.title : '', items: [] };
            continue;
        }
        current.items.push(item);
    }
    if (current.items.length > 0 || pages.length === 0) pages.push(current);
    return pages;
}

/**
 * ¿Se muestra esta página con las respuestas actuales? Una página con
 * preguntas se muestra si al menos una está a la vista (no oculta y con su
 * condición cumplida); una página sólo de títulos/textos, si alguno se ve.
 * Así una página cuyas preguntas dependen de una respuesta anterior se salta
 * sola cuando no aplica. Acepta los ítems guardados (`field_id`) y los
 * públicos (`key`, el id del campo como texto).
 */
export function formPageVisible(
    page: { items: ReadonlyArray<{ type: string; hidden?: boolean; field_id?: number; key?: string; show_if: FormCondition | null }> },
    allItems: ReadonlyArray<{ type: string; field_id?: number; key?: string; show_if: FormCondition | null }>,
    values: Record<string, unknown>,
): boolean {
    const norm = allItems.map((i) => ({ ...i, field_id: i.field_id ?? (i.key !== undefined ? Number(i.key) : undefined) }));
    const questions = page.items.filter((i) => i.type === 'field');
    if (questions.length > 0) return questions.some((i) => !i.hidden && formItemVisible(i, norm, values));
    return page.items.some((i) => formItemVisible(i, norm, values));
}

/** ¿El formulario tiene más de una página? */
export function formHasPages(items: ReadonlyArray<{ id: string; type: string }>): boolean {
    return splitFormPages(items).length > 1;
}
