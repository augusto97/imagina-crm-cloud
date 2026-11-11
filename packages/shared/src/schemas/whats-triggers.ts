/**
 * v0.1.402 — Disparadores de Whats (WhatsApp vinculado como dispositivo).
 *
 * Whats avisa de muchas cosas además de los mensajes que te escriben: el
 * estado de lo que enviaste, un contacto nuevo o que se dio de baja, una
 * conversación que empezó, se asignó o se resolvió, una calificación de la
 * atención, un clic en un enlace o un formulario enviado. Un solo disparador,
 * `whats_event`, guarda cuál de esos eventos escucha.
 *
 * Este archivo tiene lo que comparten el servidor y el editor: los eventos,
 * cómo se lee la configuración (tolerante: lo que no se entiende queda en su
 * valor por defecto), qué avisos hay que pedirle a Whats y las variables.
 *
 * Sin zod a propósito: es lógica pura.
 */

/** El disparador. */
export const WHATS_EVENT_TRIGGER = 'whats_event';

export const WHATS_EVENT_KINDS = ['message_status', 'contact_created', 'contact_unsubscribed', 'conversation', 'csat', 'link_clicked', 'form'] as const;
export type WhatsEventKind = (typeof WHATS_EVENT_KINDS)[number];

/** Una sub-opción de un evento (los estados de un mensaje, los cambios de una conversación…). */
export interface WhatsEventSubOption {
    value: string;
    label: string;
    /** El evento de Whats que le corresponde. */
    event: string;
}

export interface WhatsEventKindMeta {
    label: string;
    /** Una línea de qué es, para el editor. */
    help: string;
    /** La frase del resumen («Cuando se crea un contacto en Whats»). */
    summary: string;
    /** Los eventos de Whats (cuando no hay sub-opciones). */
    events: readonly string[];
    /** Las sub-opciones y en qué clave de la config se guardan. */
    sub: { key: 'statuses' | 'conversation_events' | 'form_events'; label: string; options: readonly WhatsEventSubOption[]; defaults: readonly string[] } | null;
    /** Si no hay un registro con ese teléfono: crearlo por defecto (contacto nuevo, formulario). */
    createByDefault: boolean;
    /** El permiso de la clave que hace falta para leer el teléfono cuando el aviso trae sólo el id del contacto. */
    needsContactLookup: boolean;
}

const STATUS_OPTIONS: readonly WhatsEventSubOption[] = [
    { value: 'sent', label: 'Enviado', event: 'wa.message.sent' },
    { value: 'delivered', label: 'Entregado', event: 'wa.message.delivered' },
    { value: 'read', label: 'Leído', event: 'wa.message.read' },
    { value: 'failed', label: 'Falló', event: 'wa.message.failed' },
    { value: 'canceled', label: 'Cancelado', event: 'wa.message.canceled' },
];

const CONVERSATION_OPTIONS: readonly WhatsEventSubOption[] = [
    { value: 'created', label: 'Empezó una conversación', event: 'conversation.created' },
    { value: 'assigned', label: 'Se asignó a alguien', event: 'conversation.assigned' },
    { value: 'resolved', label: 'Se resolvió', event: 'conversation.resolved' },
];

const FORM_OPTIONS: readonly WhatsEventSubOption[] = [
    { value: 'submitted', label: 'Lo enviaron', event: 'form.submitted' },
    { value: 'confirmed', label: 'Confirmaron su correo (doble confirmación)', event: 'form.confirmed' },
];

export const WHATS_EVENT_KIND_META: Record<WhatsEventKind, WhatsEventKindMeta> = {
    message_status: {
        label: 'Cambió el estado de un mensaje que enviaste',
        help: 'Enviado, entregado, leído, falló o se canceló. Sirve, por ejemplo, para avisar al equipo cuando un mensaje no se pudo entregar.',
        summary: 'Cuando un mensaje de Whats',
        events: [],
        sub: { key: 'statuses', label: 'Qué estados', options: STATUS_OPTIONS, defaults: ['failed'] },
        createByDefault: false,
        needsContactLookup: false,
    },
    contact_created: {
        label: 'Se creó un contacto en Whats',
        help: 'Alguien nuevo te escribió, llenó un formulario de Whats o lo agregaron a mano en tu panel.',
        summary: 'Cuando se crea un contacto en Whats',
        events: ['contact.created'],
        sub: null,
        createByDefault: true,
        needsContactLookup: true,
    },
    contact_unsubscribed: {
        label: 'Un contacto se dio de baja',
        help: 'El contacto pidió no recibir más mensajes (o lo diste de baja en Whats).',
        summary: 'Cuando un contacto se da de baja en Whats',
        events: ['contact.unsubscribed'],
        sub: null,
        createByDefault: false,
        needsContactLookup: true,
    },
    conversation: {
        label: 'Empezó, se asignó o se resolvió una conversación',
        help: 'Lo que pasa en la bandeja de Whats: una conversación nueva, asignada a alguien de tu equipo o resuelta.',
        summary: 'Cuando una conversación de Whats',
        events: [],
        sub: { key: 'conversation_events', label: 'Qué cambios', options: CONVERSATION_OPTIONS, defaults: ['created', 'assigned', 'resolved'] },
        createByDefault: false,
        needsContactLookup: true,
    },
    csat: {
        label: 'Calificaron la atención',
        help: 'El contacto respondió la encuesta de satisfacción al cerrar la conversación.',
        summary: 'Cuando califican la atención en Whats',
        events: ['csat.received'],
        sub: null,
        createByDefault: false,
        needsContactLookup: true,
    },
    link_clicked: {
        label: 'Hicieron clic en un enlace',
        help: 'El contacto abrió un enlace corto que le mandaste desde Whats.',
        summary: 'Cuando hacen clic en un enlace de Whats',
        events: ['link.clicked'],
        sub: null,
        createByDefault: false,
        needsContactLookup: true,
    },
    form: {
        label: 'Enviaron o confirmaron un formulario de Whats',
        help: 'Un formulario de suscripción de Whats. Sus respuestas quedan en {{payload.answers.x}}.',
        summary: 'Cuando un formulario de Whats',
        events: [],
        sub: { key: 'form_events', label: 'Cuándo', options: FORM_OPTIONS, defaults: ['submitted'] },
        createByDefault: true,
        needsContactLookup: true,
    },
};

/** Qué hacer si no hay un registro con ese teléfono en la lista. */
export type WhatsIfMissing = 'create' | 'skip';

export interface WhatsTriggerConfig {
    kind: WhatsEventKind;
    /** La conexión de Whats (null = cualquiera de la empresa). */
    connectionId: number | null;
    /** Las sub-opciones elegidas (nunca vacías si el evento las tiene). */
    sub: string[];
    /** El campo con el teléfono (null = el de «Configurar WhatsApp» o el primer campo Teléfono). */
    phoneFieldId: number | null;
    ifMissing: WhatsIfMissing;
}

function posInt(v: unknown): number | null {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function isKind(v: unknown): v is WhatsEventKind {
    return typeof v === 'string' && (WHATS_EVENT_KINDS as readonly string[]).includes(v);
}

/** Lee la config del disparador. Sin un evento válido, null (el editor obliga a elegirlo). */
export function readWhatsTriggerConfig(cfg: unknown): WhatsTriggerConfig | null {
    const c = cfg !== null && typeof cfg === 'object' ? (cfg as Record<string, unknown>) : {};
    if (!isKind(c.whats_event)) return null;
    const kind = c.whats_event;
    const meta = WHATS_EVENT_KIND_META[kind];
    let sub: string[] = [];
    if (meta.sub) {
        const allowed = new Set(meta.sub.options.map((o) => o.value));
        const raw = Array.isArray(c[meta.sub.key]) ? (c[meta.sub.key] as unknown[]) : [];
        sub = [...new Set(raw.map((x) => String(x)).filter((x) => allowed.has(x)))];
        if (sub.length === 0) sub = [...meta.sub.defaults];
    }
    const ifMissing: WhatsIfMissing = c.if_missing === 'create' || c.if_missing === 'skip' ? c.if_missing : meta.createByDefault ? 'create' : 'skip';
    return { kind, connectionId: posInt(c.connection_id), sub, phoneFieldId: posInt(c.phone_field_id), ifMissing };
}

/** Los eventos de Whats que escucha esta config. */
export function whatsTriggerEvents(cfg: WhatsTriggerConfig): string[] {
    const meta = WHATS_EVENT_KIND_META[cfg.kind];
    if (!meta.sub) return [...meta.events];
    return meta.sub.options.filter((o) => cfg.sub.includes(o.value)).map((o) => o.event);
}

/** Todos los eventos de Whats que algún disparador puede pedir (para validar). */
export const WHATS_TRIGGER_EVENT_NAMES: readonly string[] = WHATS_EVENT_KINDS.flatMap((k) => {
    const m = WHATS_EVENT_KIND_META[k];
    return m.sub ? m.sub.options.map((o) => o.event) : [...m.events];
});

/** ¿Este evento de Whats dispara esta config? */
export function whatsTriggerMatches(cfg: WhatsTriggerConfig, event: string, connectionId: number): boolean {
    if (cfg.connectionId !== null && cfg.connectionId !== connectionId) return false;
    return whatsTriggerEvents(cfg).includes(event);
}

/** El evento en palabras (`{{whatsapp.evento}}`). */
export const WHATS_EVENT_LABEL: Record<string, string> = {
    'wa.message.received': 'Te escribieron',
    'wa.message.sent': 'Mensaje enviado',
    'wa.message.delivered': 'Mensaje entregado',
    'wa.message.read': 'Mensaje leído',
    'wa.message.failed': 'Mensaje fallido',
    'wa.message.canceled': 'Mensaje cancelado',
    'contact.created': 'Contacto nuevo',
    'contact.unsubscribed': 'Contacto dado de baja',
    'conversation.created': 'Conversación nueva',
    'conversation.assigned': 'Conversación asignada',
    'conversation.resolved': 'Conversación resuelta',
    'csat.received': 'Calificación recibida',
    'link.clicked': 'Clic en un enlace',
    'form.submitted': 'Formulario enviado',
    'form.confirmed': 'Formulario confirmado',
};

/** Resumen del disparador («Cuando un mensaje de Whats falla o se cancela»). */
export function describeWhatsTrigger(cfg: WhatsTriggerConfig): string {
    const meta = WHATS_EVENT_KIND_META[cfg.kind];
    if (!meta.sub) return meta.summary;
    const chosen = meta.sub.options.filter((o) => cfg.sub.includes(o.value));
    const all = chosen.length === meta.sub.options.length;
    if (cfg.kind === 'message_status') {
        const words: Record<string, string> = { sent: 'se envía', delivered: 'se entrega', read: 'se lee', failed: 'falla', canceled: 'se cancela' };
        if (all) return 'Cuando cambia el estado de un mensaje de Whats';
        return `${meta.summary} ${joinOr(chosen.map((o) => words[o.value] ?? o.label.toLowerCase()))}`;
    }
    if (cfg.kind === 'conversation') {
        const words: Record<string, string> = { created: 'empieza', assigned: 'se asigna', resolved: 'se resuelve' };
        if (all) return 'Cuando una conversación de Whats empieza, se asigna o se resuelve';
        return `${meta.summary} ${joinOr(chosen.map((o) => words[o.value] ?? o.label.toLowerCase()))}`;
    }
    const words: Record<string, string> = { submitted: 'se envía', confirmed: 'se confirma' };
    return `${meta.summary} ${joinOr(chosen.map((o) => words[o.value] ?? o.label.toLowerCase()))}`;
}

function joinOr(parts: string[]): string {
    if (parts.length <= 1) return parts[0] ?? '';
    return `${parts.slice(0, -1).join(', ')} o ${parts[parts.length - 1]}`;
}

/** Variables del disparador (`{{whatsapp.x}}`). Las comunes van en todos los eventos. */
export const WHATS_EVENT_COMMON_TAGS: Array<{ tag: string; label: string }> = [
    { tag: 'whatsapp.evento', label: 'Qué pasó' },
    { tag: 'whatsapp.de', label: 'Teléfono del contacto' },
    { tag: 'whatsapp.nombre', label: 'Nombre del contacto' },
    { tag: 'whatsapp.correo', label: 'Correo del contacto' },
    { tag: 'whatsapp.contacto_id', label: 'Id del contacto en Whats' },
    { tag: 'whatsapp.fecha', label: 'Fecha y hora del aviso' },
    { tag: 'whatsapp.conexion', label: 'Conexión de Whats' },
];

export const WHATS_EVENT_KIND_TAGS: Record<WhatsEventKind, Array<{ tag: string; label: string }>> = {
    message_status: [
        { tag: 'whatsapp.estado', label: 'Estado del mensaje' },
        { tag: 'whatsapp.motivo', label: 'Por qué falló' },
        { tag: 'whatsapp.texto', label: 'Texto del mensaje' },
        { tag: 'whatsapp.mensaje_id', label: 'Id del mensaje en Whats' },
    ],
    contact_created: [],
    contact_unsubscribed: [],
    conversation: [
        { tag: 'whatsapp.conversacion_id', label: 'Id de la conversación' },
        { tag: 'whatsapp.estado_conversacion', label: 'Estado de la conversación' },
        { tag: 'whatsapp.asignado_a', label: 'A quién se asignó (id en Whats)' },
    ],
    csat: [
        { tag: 'whatsapp.calificacion', label: 'Calificación' },
        { tag: 'whatsapp.comentario', label: 'Comentario' },
        { tag: 'whatsapp.conversacion_id', label: 'Id de la conversación' },
    ],
    link_clicked: [{ tag: 'whatsapp.enlace', label: 'Enlace' }],
    form: [{ tag: 'whatsapp.formulario', label: 'Nombre del formulario' }],
};

/** Todas las variables de Whats que el selector ofrece (únicas). */
export const WHATS_EVENT_MERGE_TAGS: Array<{ tag: string; label: string }> = (() => {
    const out: Array<{ tag: string; label: string }> = [...WHATS_EVENT_COMMON_TAGS];
    for (const k of WHATS_EVENT_KINDS) {
        for (const t of WHATS_EVENT_KIND_TAGS[k]) if (!out.some((o) => o.tag === t.tag)) out.push(t);
    }
    return out;
})();

/** Lo que dice cada estado de un mensaje (`{{whatsapp.estado}}`). */
export const WHATS_MESSAGE_STATUS_LABEL: Record<string, string> = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label]));
