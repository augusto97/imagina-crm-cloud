import { z } from 'zod';
import { idSchema, isoDateTimeSchema } from './common';
import { normalizePhone, splitPhone } from '../field-types/phone';

/**
 * WhatsApp oficial — Meta WhatsApp Cloud API (D3).
 *
 * Cada empresa conecta SU cuenta de WhatsApp Business (su número, sus
 * plantillas aprobadas en Meta y su costo por conversación con Meta). La app
 * NO se convierte en un chat: en el registro queda sólo el ÚLTIMO mensaje
 * (texto, dirección, hora), el estado del último envío y, si la empresa lo
 * arma, un resumen hecho por un campo con IA. La conversación sigue viviendo
 * en WhatsApp.
 *
 * Este archivo tiene lo que comparten el servidor y la interfaz: la forma de
 * las plantillas, cómo se arman sus parámetros (lo que se prueba en el editor
 * es literalmente lo que sale), los estados y las columnas de la lista.
 */

/** Base de la Graph API de Meta (los tests apuntan a un servidor falso con `META_GRAPH_URL`). */
export const META_GRAPH_DEFAULT_URL = 'https://graph.facebook.com';
/**
 * Versión de la Graph API. v26.0 salió el 29 de julio de 2026 y Meta sostiene
 * cada versión unos dos años; se puede adelantar sin un release con
 * `META_GRAPH_VERSION` (por ejemplo cuando Meta anuncie que vence).
 */
export const META_GRAPH_DEFAULT_VERSION = 'v26.0';
/** Ventana de atención de WhatsApp: texto libre sólo hasta 24 h después del último mensaje del cliente. */
export const WHATSAPP_WINDOW_HOURS = 24;
/** Administrador de plantillas de Meta (las plantillas se crean y editan ahí). */
export function whatsappTemplateManagerUrl(wabaId: string): string {
    return `https://business.facebook.com/wa/manage/message-templates/?waba_id=${encodeURIComponent(wabaId)}`;
}

// ── Columnas de la lista ─────────────────────────────────────────────────

/**
 * Qué columnas de una lista reflejan el canal. Viven en
 * `lists.settings.whatsapp` con claves `*_field_id` (así plantillas y la
 * migración de empresa las re-mapean solas). Ninguna es obligatoria: lo que
 * no está mapeado simplemente no se escribe.
 */
export const WHATSAPP_FIELD_ROLES = [
    'phone',
    'message',
    'message_at',
    'direction',
    'profile',
    'status',
    'status_detail',
] as const;
export type WhatsappFieldRole = (typeof WHATSAPP_FIELD_ROLES)[number];

export const WHATSAPP_FIELD_ROLE_META: Record<
    WhatsappFieldRole,
    { label: string; help: string; types: readonly string[]; slug: string; create: { label: string; type: string } }
> = {
    phone: {
        label: 'Teléfono',
        help: 'Con él se encuentra al contacto cuando escribe y a quién se le manda.',
        types: ['phone', 'text'],
        slug: 'telefono',
        create: { label: 'Teléfono', type: 'phone' },
    },
    message: {
        label: 'Último mensaje',
        help: 'El texto del último mensaje, entrante o saliente (sólo el último).',
        types: ['long_text', 'text'],
        slug: 'whatsapp_ultimo_mensaje',
        create: { label: 'Último mensaje de WhatsApp', type: 'long_text' },
    },
    message_at: {
        label: 'Fecha del último mensaje',
        help: 'Cuándo llegó o salió.',
        types: ['datetime', 'date'],
        slug: 'whatsapp_fecha',
        create: { label: 'Fecha del último mensaje', type: 'datetime' },
    },
    direction: {
        label: 'Dirección',
        help: 'Entrante (lo escribió el contacto) o saliente (lo mandaste tú).',
        types: ['select', 'text'],
        slug: 'whatsapp_direccion',
        create: { label: 'Dirección del último mensaje', type: 'select' },
    },
    profile: {
        label: 'Nombre en WhatsApp',
        help: 'El nombre que el contacto tiene en su perfil.',
        types: ['text'],
        slug: 'whatsapp_nombre',
        create: { label: 'Nombre en WhatsApp', type: 'text' },
    },
    status: {
        label: 'Estado del último envío',
        help: 'Enviado, entregado, leído o fallido.',
        types: ['select', 'text'],
        slug: 'whatsapp_estado',
        create: { label: 'Estado del último envío', type: 'select' },
    },
    status_detail: {
        label: 'Detalle del envío',
        help: 'Si falló, el motivo que dio Meta.',
        types: ['text', 'long_text'],
        slug: 'whatsapp_detalle',
        create: { label: 'Detalle del envío', type: 'text' },
    },
};

/** La clave que se guarda en `settings.whatsapp` para cada columna. */
export const WHATSAPP_FIELD_KEYS: Record<WhatsappFieldRole, string> = {
    phone: 'phone_field_id',
    message: 'message_field_id',
    message_at: 'message_at_field_id',
    direction: 'direction_field_id',
    profile: 'profile_field_id',
    status: 'status_field_id',
    status_detail: 'status_detail_field_id',
};

export type WhatsappListFields = Record<WhatsappFieldRole, number | null>;

export const whatsappListFieldsSchema = z.object({
    phone: idSchema.nullable(),
    message: idSchema.nullable(),
    message_at: idSchema.nullable(),
    direction: idSchema.nullable(),
    profile: idSchema.nullable(),
    status: idSchema.nullable(),
    status_detail: idSchema.nullable(),
});

/** Lee `settings.whatsapp` (tolerante: lo que no es un id queda en null). */
export function readWhatsappListFields(settings: unknown): WhatsappListFields {
    const raw = ((settings ?? {}) as Record<string, unknown>).whatsapp;
    const obj = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const out = {} as WhatsappListFields;
    for (const role of WHATSAPP_FIELD_ROLES) {
        const n = Number(obj[WHATSAPP_FIELD_KEYS[role]]);
        out[role] = Number.isInteger(n) && n > 0 ? n : null;
    }
    return out;
}

/** El objeto que se guarda en `settings.whatsapp`. */
export function writeWhatsappListFields(fields: WhatsappListFields): Record<string, number | null> {
    const out: Record<string, number | null> = {};
    for (const role of WHATSAPP_FIELD_ROLES) out[WHATSAPP_FIELD_KEYS[role]] = fields[role];
    return out;
}

/**
 * Sugerencia de columnas: lo que la persona ya tiene con el nombre esperado
 * (las que creó «Preparar columnas» o una plantilla) y, para el teléfono, el
 * primer campo Teléfono de la lista.
 */
export function suggestWhatsappFields(
    fields: ReadonlyArray<{ id: number; slug: string; type: string }>,
): WhatsappListFields {
    const out = {} as WhatsappListFields;
    for (const role of WHATSAPP_FIELD_ROLES) {
        const meta = WHATSAPP_FIELD_ROLE_META[role];
        const bySlug = fields.find((f) => f.slug === meta.slug && meta.types.includes(f.type));
        out[role] = bySlug?.id ?? null;
    }
    if (out.phone === null) out.phone = fields.find((f) => f.type === 'phone')?.id ?? null;
    return out;
}

// ── Dirección y estados ──────────────────────────────────────────────────

export const WHATSAPP_DIRECTION_OPTIONS = {
    in: { value: 'entrante', label: 'Entrante', color: '#0EA5E9' },
    out: { value: 'saliente', label: 'Saliente', color: '#22C55E' },
} as const;

export const WHATSAPP_STATUSES = ['enviado', 'entregado', 'leido', 'fallido'] as const;
export type WhatsappStatus = (typeof WHATSAPP_STATUSES)[number];

export const WHATSAPP_STATUS_OPTIONS: Record<WhatsappStatus, { value: WhatsappStatus; label: string; color: string }> = {
    enviado: { value: 'enviado', label: 'Enviado', color: '#64748B' },
    entregado: { value: 'entregado', label: 'Entregado', color: '#0EA5E9' },
    leido: { value: 'leido', label: 'Leído', color: '#22C55E' },
    fallido: { value: 'fallido', label: 'Fallido', color: '#EF4444' },
};

/** Estado de Meta (`sent`, `delivered`, `read`, `failed`) → el nuestro. */
export function whatsappStatusFromMeta(status: unknown): WhatsappStatus | null {
    switch (String(status ?? '').toLowerCase()) {
        case 'sent':
        case 'accepted':
            return 'enviado';
        case 'delivered':
            return 'entregado';
        case 'read':
            return 'leido';
        case 'failed':
            return 'fallido';
        default:
            return null;
    }
}

const STATUS_RANK: Record<WhatsappStatus, number> = { enviado: 1, entregado: 2, leido: 3, fallido: 0 };

/**
 * Meta manda los estados en cualquier orden (un «leído» puede llegar antes que
 * el «entregado») y los REINTENTA. Un estado sólo avanza: un «entregado» tardío
 * no pisa un «leído». Un «fallido» gana mientras el mensaje no se haya leído
 * (no hay vuelta atrás desde leído). Devuelve el estado que queda, o `null` si
 * no hay que cambiar nada.
 */
export function nextWhatsappStatus(current: WhatsappStatus | null, incoming: WhatsappStatus): WhatsappStatus | null {
    if (current === incoming) return null;
    if (current === null) return incoming;
    if (incoming === 'fallido') return current === 'leido' ? null : 'fallido';
    if (current === 'fallido') return null;
    return STATUS_RANK[incoming] > STATUS_RANK[current] ? incoming : null;
}

/** ¿Está abierta la ventana de 24 h? */
export function whatsappWindowOpen(lastInboundAt: Date | string | null | undefined, now: Date = new Date()): boolean {
    if (!lastInboundAt) return false;
    const at = lastInboundAt instanceof Date ? lastInboundAt : new Date(lastInboundAt);
    if (Number.isNaN(at.getTime())) return false;
    return now.getTime() - at.getTime() < WHATSAPP_WINDOW_HOURS * 3_600_000;
}

/** Cuándo se cierra la ventana (null si nunca escribió). */
export function whatsappWindowClosesAt(lastInboundAt: Date | string | null | undefined): Date | null {
    if (!lastInboundAt) return null;
    const at = lastInboundAt instanceof Date ? lastInboundAt : new Date(lastInboundAt);
    return Number.isNaN(at.getTime()) ? null : new Date(at.getTime() + WHATSAPP_WINDOW_HOURS * 3_600_000);
}

// ── Teléfonos ────────────────────────────────────────────────────────────

/**
 * El destinatario como lo pide Meta: sólo dígitos con el indicativo, sin `+`.
 * Un número local (sin indicativo) toma el del país del número de la empresa,
 * que casi siempre es el de sus clientes. `null` + motivo si no es un teléfono.
 */
export function whatsappRecipient(
    raw: unknown,
    defaultCountry?: string | null,
): { ok: true; digits: string } | { ok: false; error: string } {
    const n = normalizePhone(raw, defaultCountry ?? null);
    if (!n.ok) return { ok: false, error: n.error };
    if (!n.value.startsWith('+')) {
        return { ok: false, error: 'El número necesita el indicativo del país (por ejemplo +57 300 111 2233).' };
    }
    return { ok: true, digits: n.value.slice(1) };
}

/** El país (ISO2) del número de la empresa, para completar números locales. */
export function whatsappCountryOf(displayPhone: string | null | undefined): string | null {
    if (!displayPhone) return null;
    const raw = displayPhone.trim().startsWith('+') ? displayPhone : `+${displayPhone.replace(/\D/g, '')}`;
    return splitPhone(raw).country?.iso2 ?? null;
}

/**
 * Las formas en que puede estar guardado un número que llega de WhatsApp. Meta
 * identifica a un contacto de México con `521…` (el «1» de celular viejo) y a
 * uno de Argentina con `549…`; en la lista suele estar guardado sin ese dígito.
 * Se buscan las dos formas.
 */
export function whatsappIdVariants(waId: string): string[] {
    const d = String(waId ?? '').replace(/\D/g, '');
    if (d === '') return [];
    const out = new Set<string>([d]);
    if (d.startsWith('521') && d.length === 13) out.add(`52${d.slice(3)}`);
    if (d.startsWith('52') && d.length === 12) out.add(`521${d.slice(2)}`);
    if (d.startsWith('549') && d.length === 13) out.add(`54${d.slice(3)}`);
    if (d.startsWith('54') && d.length === 12) out.add(`549${d.slice(2)}`);
    return [...out];
}

// ── Plantillas ───────────────────────────────────────────────────────────

export const WHATSAPP_TEMPLATE_CATEGORY_LABEL: Record<string, string> = {
    MARKETING: 'Marketing',
    UTILITY: 'Utilidad',
    AUTHENTICATION: 'Autenticación',
};

export const WHATSAPP_TEMPLATE_STATUS_LABEL: Record<string, string> = {
    APPROVED: 'Aprobada',
    PENDING: 'En revisión',
    REJECTED: 'Rechazada',
    PAUSED: 'Pausada',
    DISABLED: 'Desactivada',
    IN_APPEAL: 'En apelación',
    PENDING_DELETION: 'Borrándose',
    DELETED: 'Borrada',
    LIMIT_EXCEEDED: 'Límite excedido',
};

export type WhatsappHeaderFormat = 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';

export interface WhatsappTemplateButton {
    /** Posición dentro de los botones (Meta la pide como texto). */
    index: number;
    type: string;
    text: string;
    url: string | null;
    phone: string | null;
    /** El botón pide un valor al enviar (URL dinámica, código de cupón, OTP). */
    dynamic: boolean;
}

/** Lo que importa de una plantilla para armar un envío (derivado de sus componentes). */
export interface WhatsappTemplateShape {
    parameter_format: 'POSITIONAL' | 'NAMED';
    header: { format: WhatsappHeaderFormat; text: string | null; vars: string[] } | null;
    body: { text: string; vars: string[] };
    footer: string | null;
    buttons: WhatsappTemplateButton[];
}

/** Una variable que la plantilla pide, con la clave con que se guarda su valor. */
export interface WhatsappTemplateVariable {
    /** `header.1`, `body.nombre`, `button.0`. */
    key: string;
    part: 'header' | 'body' | 'button';
    /** `1`, `nombre` o el índice del botón. */
    name: string;
    label: string;
    /** Ejemplo que dio la empresa al crear la plantilla en Meta. */
    example: string | null;
}

const VAR_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

function varsIn(text: string, positional: boolean): string[] {
    const seen: string[] = [];
    for (const m of text.matchAll(VAR_RE)) {
        const name = m[1]!;
        if (!seen.includes(name)) seen.push(name);
    }
    if (positional) {
        return seen.filter((v) => /^\d+$/.test(v)).sort((a, b) => Number(a) - Number(b));
    }
    return seen;
}

function asRecord(v: unknown): Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Interpreta los `components` crudos de una plantilla de Meta. */
export function whatsappTemplateShape(components: unknown, parameterFormat?: unknown): WhatsappTemplateShape {
    const named = String(parameterFormat ?? '').toUpperCase() === 'NAMED';
    const list = Array.isArray(components) ? components.map(asRecord) : [];
    const shape: WhatsappTemplateShape = {
        parameter_format: named ? 'NAMED' : 'POSITIONAL',
        header: null,
        body: { text: '', vars: [] },
        footer: null,
        buttons: [],
    };
    for (const c of list) {
        const type = String(c.type ?? '').toUpperCase();
        if (type === 'HEADER') {
            const format = String(c.format ?? 'TEXT').toUpperCase() as WhatsappHeaderFormat;
            const text = typeof c.text === 'string' ? c.text : null;
            shape.header = { format, text, vars: text && format === 'TEXT' ? varsIn(text, !named) : [] };
        } else if (type === 'BODY') {
            const text = typeof c.text === 'string' ? c.text : '';
            shape.body = { text, vars: varsIn(text, !named) };
        } else if (type === 'FOOTER') {
            shape.footer = typeof c.text === 'string' ? c.text : null;
        } else if (type === 'BUTTONS') {
            const buttons = Array.isArray(c.buttons) ? c.buttons.map(asRecord) : [];
            buttons.forEach((b, index) => {
                const btype = String(b.type ?? '').toUpperCase();
                const url = typeof b.url === 'string' ? b.url : null;
                const dynamic =
                    (btype === 'URL' && url !== null && /\{\{\s*[A-Za-z0-9_]+\s*\}\}/.test(url)) ||
                    btype === 'COPY_CODE' ||
                    btype === 'OTP';
                shape.buttons.push({
                    index,
                    type: btype,
                    text: typeof b.text === 'string' ? b.text : btype === 'COPY_CODE' ? 'Copiar código' : '',
                    url,
                    phone: typeof b.phone_number === 'string' ? b.phone_number : null,
                    dynamic,
                });
            });
        }
    }
    return shape;
}

function exampleFor(components: unknown, part: 'header' | 'body', name: string, named: boolean): string | null {
    const list = Array.isArray(components) ? components.map(asRecord) : [];
    const comp = list.find((c) => String(c.type ?? '').toUpperCase() === part.toUpperCase());
    const ex = asRecord(comp?.example);
    if (named) {
        const key = part === 'header' ? 'header_text_named_params' : 'body_text_named_params';
        const arr = Array.isArray(ex[key]) ? (ex[key] as unknown[]).map(asRecord) : [];
        const hit = arr.find((p) => p.param_name === name);
        return typeof hit?.example === 'string' ? hit.example : null;
    }
    const idx = Number(name) - 1;
    if (part === 'header') {
        const arr = Array.isArray(ex.header_text) ? (ex.header_text as unknown[]) : [];
        return typeof arr[idx] === 'string' ? (arr[idx] as string) : null;
    }
    const rows = Array.isArray(ex.body_text) ? (ex.body_text as unknown[]) : [];
    const first = Array.isArray(rows[0]) ? (rows[0] as unknown[]) : [];
    return typeof first[idx] === 'string' ? (first[idx] as string) : null;
}

/** Las variables que pide una plantilla, en el orden en que se muestran. */
export function whatsappTemplateVariables(components: unknown, parameterFormat?: unknown): WhatsappTemplateVariable[] {
    const shape = whatsappTemplateShape(components, parameterFormat);
    const named = shape.parameter_format === 'NAMED';
    const out: WhatsappTemplateVariable[] = [];
    if (shape.header?.format === 'TEXT') {
        for (const v of shape.header.vars) {
            out.push({ key: `header.${v}`, part: 'header', name: v, label: `Encabezado {{${v}}}`, example: exampleFor(components, 'header', v, named) });
        }
    }
    for (const v of shape.body.vars) {
        out.push({ key: `body.${v}`, part: 'body', name: v, label: `Mensaje {{${v}}}`, example: exampleFor(components, 'body', v, named) });
    }
    for (const b of shape.buttons) {
        if (!b.dynamic) continue;
        const label =
            b.type === 'COPY_CODE'
                ? 'Código del cupón'
                : b.type === 'OTP'
                  ? 'Código de verificación'
                  : `Botón «${b.text}» (final del enlace)`;
        out.push({ key: `button.${b.index}`, part: 'button', name: String(b.index), label, example: null });
    }
    return out;
}

/** Lo que guarda la acción / el envío manual de una plantilla. */
export interface WhatsappTemplateValues {
    /** Valor de cada variable (`body.1`, `header.nombre`, `button.0`), ya resuelto. */
    variables: Record<string, string>;
    /** Encabezado con imagen, video o documento: el enlace público (https). */
    header_media?: string;
    /** Nombre con que llega el documento del encabezado. */
    header_filename?: string;
}

/**
 * Meta rechaza un parámetro con saltos de línea, tabuladores o más de cuatro
 * espacios seguidos (error 132018). Un campo de texto largo del registro los
 * trae: se aplanan en vez de que el envío falle.
 */
export function cleanWhatsappParam(text: string): string {
    return text
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/ {4,}/g, '   ')
        .trim()
        .slice(0, 1024);
}

function fillVars(text: string, part: 'header' | 'body', variables: Record<string, string>): string {
    return text.replace(VAR_RE, (m, name: string) => {
        const v = variables[`${part}.${name}`];
        return typeof v === 'string' && v.trim() !== '' ? cleanWhatsappParam(v) : m;
    });
}

/**
 * El texto que verá el contacto (encabezado + mensaje + pie), con las
 * variables puestas. Lo usa la vista previa del editor y es lo que queda como
 * «último mensaje» del registro al enviar una plantilla.
 */
export function renderWhatsappTemplate(
    components: unknown,
    parameterFormat: unknown,
    variables: Record<string, string>,
): { header: string | null; body: string; footer: string | null; buttons: string[]; text: string } {
    const shape = whatsappTemplateShape(components, parameterFormat);
    const header =
        shape.header?.format === 'TEXT' && shape.header.text
            ? fillVars(shape.header.text, 'header', variables)
            : shape.header
              ? `[${HEADER_FORMAT_LABEL[shape.header.format] ?? 'Adjunto'}]`
              : null;
    const body = fillVars(shape.body.text, 'body', variables);
    const buttons = shape.buttons.map((b) => b.text).filter((t) => t !== '');
    const text = [header, body, shape.footer].filter((x): x is string => typeof x === 'string' && x !== '').join('\n\n');
    return { header, body, footer: shape.footer, buttons, text };
}

export const HEADER_FORMAT_LABEL: Record<string, string> = {
    TEXT: 'Texto',
    IMAGE: 'Imagen',
    VIDEO: 'Video',
    DOCUMENT: 'Documento',
    LOCATION: 'Ubicación',
};

/**
 * Los `components` del envío de una plantilla, como los pide la Cloud API.
 * PURO: el probador del editor, el envío manual y la automatización arman
 * exactamente lo mismo. Devuelve qué falta en vez de mandar algo que Meta
 * rechazaría con un error críptico (132000: «la cantidad de parámetros no
 * coincide»).
 */
export function buildWhatsappTemplateComponents(
    components: unknown,
    parameterFormat: unknown,
    values: WhatsappTemplateValues,
): { ok: true; components: Array<Record<string, unknown>> } | { ok: false; missing: string[]; error: string } {
    const shape = whatsappTemplateShape(components, parameterFormat);
    const named = shape.parameter_format === 'NAMED';
    const missing: string[] = [];
    const out: Array<Record<string, unknown>> = [];
    const param = (part: 'header' | 'body', name: string): Record<string, unknown> | null => {
        const raw = values.variables[`${part}.${name}`];
        const text = typeof raw === 'string' ? cleanWhatsappParam(raw) : '';
        if (text === '') {
            missing.push(`{{${name}}} del ${part === 'header' ? 'encabezado' : 'mensaje'}`);
            return null;
        }
        return named ? { type: 'text', parameter_name: name, text } : { type: 'text', text };
    };
    if (shape.header) {
        if (shape.header.format === 'TEXT') {
            const params = shape.header.vars.map((v) => param('header', v)).filter((p): p is Record<string, unknown> => p !== null);
            if (shape.header.vars.length > 0 && params.length === shape.header.vars.length) out.push({ type: 'header', parameters: params });
        } else if (shape.header.format === 'IMAGE' || shape.header.format === 'VIDEO' || shape.header.format === 'DOCUMENT') {
            const link = (values.header_media ?? '').trim();
            if (link === '') {
                missing.push(`el enlace del ${HEADER_FORMAT_LABEL[shape.header.format]!.toLowerCase()} del encabezado`);
            } else if (!/^https:\/\/[^\s]+$/i.test(link)) {
                return { ok: false, missing: [], error: 'El enlace del encabezado tiene que ser una dirección pública que empiece con https://' };
            } else {
                const kind = shape.header.format.toLowerCase();
                const media: Record<string, unknown> = { link };
                const filename = (values.header_filename ?? '').trim();
                if (kind === 'document') {
                    media.filename = filename !== '' ? filename.slice(0, 240) : decodeURIComponent(link.split(/[?#]/)[0]!.split('/').pop() || 'documento.pdf');
                }
                out.push({ type: 'header', parameters: [{ type: kind, [kind]: media }] });
            }
        }
    }
    if (shape.body.vars.length > 0) {
        const params = shape.body.vars.map((v) => param('body', v)).filter((p): p is Record<string, unknown> => p !== null);
        if (params.length === shape.body.vars.length) out.push({ type: 'body', parameters: params });
    }
    for (const b of shape.buttons) {
        if (!b.dynamic) continue;
        const raw = values.variables[`button.${b.index}`];
        const text = typeof raw === 'string' ? cleanWhatsappParam(raw) : '';
        if (text === '') {
            missing.push(b.type === 'COPY_CODE' ? 'el código del cupón' : `el final del enlace del botón «${b.text}»`);
            continue;
        }
        if (b.type === 'COPY_CODE') {
            out.push({ type: 'button', sub_type: 'copy_code', index: String(b.index), parameters: [{ type: 'coupon_code', coupon_code: text }] });
        } else {
            out.push({ type: 'button', sub_type: 'url', index: String(b.index), parameters: [{ type: 'text', text }] });
        }
    }
    if (missing.length > 0) {
        return { ok: false, missing, error: `Falta completar: ${missing.join(', ')}.` };
    }
    return { ok: true, components: out };
}

// ── API ──────────────────────────────────────────────────────────────────

export const whatsappTemplateSchema = z.object({
    id: idSchema,
    meta_id: z.string(),
    name: z.string(),
    language: z.string(),
    category: z.string(),
    status: z.string(),
    parameter_format: z.enum(['POSITIONAL', 'NAMED']),
    components: z.array(z.record(z.unknown())),
    rejected_reason: z.string().nullable(),
    synced_at: isoDateTimeSchema,
});
export type WhatsappTemplate = z.infer<typeof whatsappTemplateSchema>;

/** Dónde caen los mensajes entrantes de una conexión. */
export const whatsappConnectionConfigSchema = z.object({
    inbound_list_id: idSchema.nullable().default(null),
    /** Si el número no está en la lista, crear el registro (con su nombre de perfil). */
    create_contacts: z.boolean().default(true),
});
export type WhatsappConnectionConfig = z.infer<typeof whatsappConnectionConfigSchema>;

export function readWhatsappConnectionConfig(config: unknown): WhatsappConnectionConfig {
    const raw = asRecord(asRecord(config).whatsapp);
    const parsed = whatsappConnectionConfigSchema.safeParse(raw);
    return parsed.success ? parsed.data : whatsappConnectionConfigSchema.parse({});
}

export const updateWhatsappConfigSchema = z.object({
    inbound_list_id: idSchema.nullable(),
    create_contacts: z.boolean(),
    /** Columnas de la lista de entrada (se guardan en esa lista). */
    fields: whatsappListFieldsSchema.optional(),
});
export type UpdateWhatsappConfigInput = z.infer<typeof updateWhatsappConfigSchema>;

export const updateWhatsappListFieldsSchema = z.object({ fields: whatsappListFieldsSchema });
export type UpdateWhatsappListFieldsInput = z.infer<typeof updateWhatsappListFieldsSchema>;

export interface WhatsappListColumns {
    list_id: number;
    list_name: string;
    fields: WhatsappListFields;
    /** Los campos de la lista que sirven para cada columna. */
    candidates: Record<WhatsappFieldRole, Array<{ id: number; label: string; type: string }>>;
}

/** Panel de una conexión de WhatsApp (Integraciones → WhatsApp). */
export interface WhatsappConnectionDetail {
    connection: {
        id: number;
        name: string;
        phone_number_id: string;
        waba_id: string;
        display_phone: string | null;
        verified_name: string | null;
        quality_rating: string | null;
        can_edit: boolean;
        secret_state: 'none' | 'ok' | 'unreadable';
        has_app_secret: boolean;
    };
    webhook: {
        url: string;
        verify_token: string;
        last_hook_at: string | null;
        /** La app de Meta está suscrita a la cuenta (null = no se pudo consultar). */
        subscribed: boolean | null;
        subscribe_error: string | null;
    };
    config: WhatsappConnectionConfig;
    inbound_columns: WhatsappListColumns | null;
    lists: Array<{ id: number; name: string }>;
    templates: WhatsappTemplate[];
    templates_synced_at: string | null;
    template_manager_url: string;
    totals: { contacts: number; open_windows: number };
    last_error: string | null;
}

/** Lo que muestra la ficha de un registro para «Enviar WhatsApp». */
export interface WhatsappRecordInfo {
    connections: Array<{
        id: number;
        name: string;
        display_phone: string | null;
        /** Ventana de 24 h con el número del registro. */
        window_open: boolean;
        last_inbound_at: string | null;
        window_closes_at: string | null;
        last_status: WhatsappStatus | null;
        last_status_detail: string | null;
        last_outbound_at: string | null;
        templates: WhatsappTemplate[];
    }>;
    /** El número del registro (canónico, con +), o null si no tiene. */
    recipient: string | null;
    /** La lista tiene columnas de WhatsApp (si no, el estado no queda en el registro). */
    has_columns: boolean;
    can_send: boolean;
    can_setup: boolean;
}

export const whatsappSendSchema = z
    .object({
        connection_id: idSchema,
        /** Vacío = el teléfono del registro. Admite variables del registro. */
        to: z.string().trim().max(200).optional(),
        kind: z.enum(['template', 'text']),
        template: z.string().trim().max(512).optional(),
        language: z.string().trim().max(16).optional(),
        variables: z.record(z.string().max(2000)).default({}),
        header_media: z.string().trim().max(2000).optional(),
        header_filename: z.string().trim().max(240).optional(),
        text: z.string().max(4096).optional(),
        preview_url: z.boolean().optional(),
    })
    .refine((v) => v.kind === 'text' || (v.template ?? '') !== '', { message: 'Elige la plantilla.' })
    .refine((v) => v.kind === 'template' || (v.text ?? '').trim() !== '', { message: 'Escribe el mensaje.' });
export type WhatsappSendInput = z.infer<typeof whatsappSendSchema>;

/** «Probar ahora» del editor: envía DE VERDAD a un número que se escribe. */
export const whatsappTestSendSchema = z
    .object({
        connection_id: idSchema,
        to: z.string().trim().min(1).max(200),
        kind: z.enum(['template', 'text']),
        /** Los `values` de la acción tal cual se están editando (con variables). */
        values: z.record(z.unknown()).default({}),
        /** Registro para resolver las variables (default: el último de la lista). */
        record_id: z.number().int().positive().optional(),
    });
export type WhatsappTestSendInput = z.infer<typeof whatsappTestSendSchema>;

export interface WhatsappSendResult {
    ok: boolean;
    /** Id del mensaje en Meta (`wamid…`). */
    message_id: string | null;
    to: string;
    /** El texto que verá el contacto. */
    text: string;
    status: WhatsappStatus | null;
    error: string | null;
    /** Lo que se mandó a la Graph API (sin el token). */
    request: { url: string; body: string } | null;
    /** Lo que contestó Meta. */
    response: { status: number; body: string } | null;
    sample_record_id?: number | null;
}

/** Contexto `{{whatsapp.x}}` del disparador «Cuando llega un mensaje de WhatsApp». */
export interface WhatsappEventInfo {
    texto: string;
    /** El número del contacto, con +. */
    de: string;
    nombre: string;
    /** text, image, audio, document, video, location, button, interactive… */
    tipo: string;
    conexion: string;
    conexion_id: number;
    mensaje_id: string;
    fecha: string;
}

/** Variables del disparador para el editor (`{{whatsapp.texto}}`…). */
export const WHATSAPP_MERGE_TAGS: Array<{ tag: string; label: string }> = [
    { tag: 'whatsapp.texto', label: 'Texto del mensaje' },
    { tag: 'whatsapp.de', label: 'Número del contacto' },
    { tag: 'whatsapp.nombre', label: 'Nombre en WhatsApp' },
    { tag: 'whatsapp.tipo', label: 'Tipo de mensaje' },
    { tag: 'whatsapp.fecha', label: 'Fecha y hora del mensaje' },
    { tag: 'whatsapp.conexion', label: 'Número de la empresa que lo recibió' },
];
