import { WHATS_EVENT_LABEL, WHATS_MESSAGE_STATUS_LABEL, WHATS_TRIGGER_EVENT_NAMES, type WhatsappEventInfo } from '@imagina-base/shared';
import { createHash } from 'node:crypto';

/**
 * v0.1.402 — Lee un aviso de Whats para el disparador «Cuando pasa algo en
 * Whats». PURO.
 *
 * La documentación trae ejemplos sólo de los mensajes y las citas; para el
 * resto (contactos, conversaciones, calificaciones, clics, formularios) se
 * lee con TOLERANCIA a partir de la forma de cada recurso en la API
 * (`GET /contacts/{id}`, `GET /conversations/{id}`, las respuestas de un
 * formulario): se prueban los nombres de campo más probables y, si el aviso
 * trae sólo el id del contacto, el servicio le pregunta su teléfono a Whats.
 * SUPUESTO marcado: los nombres alternativos (`rating`/`score`,
 * `url`/`link.url`…) no los confirma la documentación. Todo lo que trae el
 * aviso queda además como `{{payload.…}}`.
 */

export interface ParsedWhatsEvent {
    event: string;
    /** Id de la entrega (el mismo en cada reintento). */
    deliveryId: string;
    /** El número de la empresa (en los avisos de mensajes); null en los de toda la cuenta. */
    accountId: number | null;
    /** El teléfono del contacto, sólo dígitos (null = el aviso no lo trae). */
    phone: string | null;
    contactId: number | null;
    name: string;
    email: string;
    /** El mensaje (estados de lo enviado): con él se encuentra el registro que lo mandó. */
    messageId: string | null;
    /** Lo que queda como `{{whatsapp.x}}` (sin `de`, `conexion`, que pone el servicio). */
    info: Partial<WhatsappEventInfo>;
    /** El objeto del evento tal cual (para `{{payload.…}}`). */
    payload: Record<string, unknown>;
    at: string;
    /** Una huella del evento: el mismo evento que llega por dos conexiones dispara una vez. */
    fingerprint: string;
}

function rec(v: unknown): Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
    return typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

function first(...values: unknown[]): string {
    for (const v of values) {
        const s = str(v);
        if (s !== '') return s;
    }
    return '';
}

function posInt(v: unknown): number | null {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : null;
}

/** Sólo los dígitos de un teléfono (un grupo `…@g.us` o un `status@broadcast` no es un contacto). */
function phoneDigits(v: unknown): string | null {
    const s = str(v);
    if (s === '' || s.includes('@')) return null;
    const d = s.replace(/\D/g, '');
    return d.length >= 6 ? d : null;
}

function isoOf(...values: unknown[]): string {
    for (const v of values) {
        const s = str(v);
        if (s === '') continue;
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) return d.toISOString();
    }
    return new Date().toISOString();
}

const FAILURE_TEXT: Record<string, string> = {
    canceled: 'Se canceló antes de salir.',
    expired: 'Venció antes de poder enviarse.',
    unsubscribed: 'El contacto se dio de baja de tus mensajes en Whats.',
    insufficient_credits: 'No había créditos suficientes en tu cuenta de WhatsApp.',
    no_whatsapp: 'Ese número no tiene WhatsApp.',
    invalid_number: 'El número no es válido.',
    rate_limited: 'Se frenó por el límite de envíos.',
    channel_unavailable: 'El número de la empresa no estaba disponible (¿desconectado?).',
    whatsapp_rejected: 'WhatsApp rechazó el mensaje.',
    invalid_recipient: 'El destinatario no es válido.',
};

/** El aviso es de un evento que el disparador sabe leer. */
export function isWhatsTriggerEvent(event: string): boolean {
    return (WHATS_TRIGGER_EVENT_NAMES as readonly string[]).includes(event);
}

/**
 * Lee un aviso de Whats. `null` = no es un evento del disparador, o es de un
 * mensaje que no es de WhatsApp (SMS, la cuenta oficial) o de un grupo.
 */
export function parseWhatsEvent(body: unknown, headerEvent?: string): ParsedWhatsEvent | null {
    const root = rec(body);
    const event = str(root.event) || str(headerEvent);
    if (!isWhatsTriggerEvent(event)) return null;
    let p = rec(root.payload);
    // Una entrega guardada trae el objeto envuelto otra vez en `payload`.
    if (Object.keys(p).length === 1 && Object.keys(rec(p.payload)).length > 0) p = rec(p.payload);
    const deliveryId = str(root.id);
    const contact = rec(p.contact);
    const answers = rec(p.answers);
    const info: Partial<WhatsappEventInfo> = { evento: WHATS_EVENT_LABEL[event] ?? event };
    let accountId: number | null = null;
    let phone: string | null = null;
    let contactId: number | null = posInt(first(p.contact_id, contact.id));
    let name = first(contact.name, p.contact_name, p.name, answers.name, [str(answers.first_name), str(answers.last_name)].filter(Boolean).join(' '));
    let email = first(contact.email, p.contact_email, p.email, answers.email);
    let messageId: string | null = null;

    if (event.startsWith('wa.message.')) {
        // Un aviso de mensajes de otro canal (SMS, la cuenta oficial) no es de este número.
        const channel = str(p.channel);
        if (channel !== '' && channel !== 'wa') return null;
        const conn = rec(p.connection);
        const accountNum = posInt(conn.id);
        accountId = str(conn.type) !== '' && str(conn.type) !== 'wa' ? null : accountNum;
        const to = str(p.to);
        if (to.includes('@')) return null; // un envío a un grupo
        phone = phoneDigits(to);
        messageId = str(p.id) || null;
        const status = event.slice('wa.message.'.length);
        info.estado = WHATS_MESSAGE_STATUS_LABEL[status] ?? status;
        const reason = str(p.failure_reason);
        const raw = first(p.error_message, p.error_reason, p.error);
        if (status === 'failed' || status === 'canceled') {
            info.motivo = [FAILURE_TEXT[reason], raw].filter(Boolean).join(' ') || (status === 'canceled' ? FAILURE_TEXT.canceled! : 'No se pudo entregar el mensaje.');
        }
        info.texto = str(p.body);
        info.mensaje_id = messageId ?? '';
        name = first(contact.name, p.contact_name);
        email = first(contact.email);
    } else if (event.startsWith('contact.')) {
        // El objeto es el contacto (`GET /contacts/{id}`) o lo trae adentro.
        const c = Object.keys(contact).length > 0 ? contact : p;
        contactId = posInt(first(c.id, p.contact_id));
        phone = phoneDigits(first(c.phone, p.phone));
        name = first(c.name, p.name);
        email = first(c.email, p.email);
    } else if (event.startsWith('conversation.')) {
        const conv = Object.keys(rec(p.conversation)).length > 0 ? rec(p.conversation) : p;
        const convContact = rec(conv.contact);
        contactId = posInt(first(conv.contact_id, convContact.id, p.contact_id));
        phone = phoneDigits(first(convContact.phone, conv.phone, p.phone, contact.phone));
        name = first(convContact.name, contact.name, conv.name, p.contact_name);
        email = first(convContact.email, contact.email);
        info.conversacion_id = first(conv.id, p.conversation_id);
        info.estado_conversacion = first(conv.status, p.status);
        info.asignado_a = first(conv.assigned_member_id, p.assigned_member_id, p.assigned_to, rec(p.assignee).id, conv.team_id);
    } else if (event === 'csat.received') {
        phone = phoneDigits(first(contact.phone, p.phone));
        info.calificacion = first(p.rating, p.score, p.csat, p.value, rec(p.csat).rating);
        info.comentario = first(p.comment, p.feedback, rec(p.csat).comment);
        info.conversacion_id = first(p.conversation_id, rec(p.conversation).id);
    } else if (event === 'link.clicked') {
        phone = phoneDigits(first(contact.phone, p.phone));
        info.enlace = first(p.url, rec(p.link).url, p.destination, p.original_url, p.target_url);
    } else if (event.startsWith('form.')) {
        phone = phoneDigits(first(answers.phone, contact.phone, p.phone));
        info.formulario = first(p.form_name, rec(p.form).name);
    }

    if (contactId !== null) info.contacto_id = String(contactId);
    const at = isoOf(p.read_at, p.delivered_at, p.sent_at, p.resolved_at, p.submitted_at, p.confirmed_at, p.updated_at, p.created_at, root.sent_at);
    const fingerprint = createHash('sha1')
        .update(`${event}:${JSON.stringify(p)}`)
        .digest('hex');
    return { event, deliveryId, accountId, phone, contactId, name, email, messageId, info, payload: p, at, fingerprint };
}
