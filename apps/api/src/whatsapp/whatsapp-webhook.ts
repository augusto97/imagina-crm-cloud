import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * D3 — Avisos de Meta (webhooks de WhatsApp Cloud API). PURO.
 *
 * Meta firma cada POST con `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256
 * del cuerpo CRUDO con la clave secreta de la app. Se compara en tiempo
 * constante y sobre los bytes recibidos: re-serializar el JSON cambiaría
 * espacios y escapes (Meta escapa los no-ASCII como \uXXXX) y ninguna firma
 * válida coincidiría.
 */
export function verifyMetaSignature(appSecret: string, rawBody: string, header: string | undefined): boolean {
    if (!header || appSecret === '') return false;
    const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
    if (!m) return false;
    const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest();
    const given = Buffer.from(m[1]!, 'hex');
    return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Un mensaje que escribió un contacto. */
export interface InboundMessage {
    phoneNumberId: string;
    /** El número del contacto como lo identifica Meta (dígitos, sin `+`). */
    waId: string;
    profileName: string | null;
    id: string;
    at: Date;
    type: string;
    /** Resumen legible (texto, o «[Imagen] pie de foto»…). */
    text: string;
}

/** Un cambio de estado de un mensaje que mandó la empresa. */
export interface StatusUpdate {
    phoneNumberId: string;
    id: string;
    status: string;
    at: Date;
    recipientId: string;
    errors: Array<{ code: number | null; title: string; message: string; details: string | null }>;
}

export interface ParsedWebhook {
    messages: InboundMessage[];
    statuses: StatusUpdate[];
    /** Cambió el estado de una plantilla (aprobada, rechazada, pausada…). */
    templateChanges: number;
}

function rec(v: unknown): Record<string, unknown> {
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): Array<Record<string, unknown>> {
    return Array.isArray(v) ? v.map(rec) : [];
}

function str(v: unknown): string {
    return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function when(ts: unknown): Date {
    const n = Number(ts);
    return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}

const MEDIA_LABEL: Record<string, string> = {
    image: 'Imagen',
    video: 'Video',
    audio: 'Audio',
    voice: 'Nota de voz',
    document: 'Documento',
    sticker: 'Sticker',
};

/**
 * Lo que queda como «último mensaje» del registro. Los adjuntos NO se
 * descargan: se nombra el tipo y su pie de foto (o el nombre del documento).
 */
export function inboundText(m: Record<string, unknown>): string {
    const type = str(m.type);
    const part = rec(m[type]);
    switch (type) {
        case 'text':
            return str(rec(m.text).body);
        case 'image':
        case 'video':
        case 'audio':
        case 'document':
        case 'sticker': {
            const label = type === 'audio' && part.voice === true ? MEDIA_LABEL.voice! : MEDIA_LABEL[type]!;
            const extra = str(part.caption) || (type === 'document' ? str(part.filename) : '');
            return extra !== '' ? `[${label}] ${extra}` : `[${label}]`;
        }
        case 'location': {
            const name = [str(part.name), str(part.address)].filter((x) => x !== '').join(', ');
            return name !== '' ? `[Ubicación] ${name}` : `[Ubicación] ${str(part.latitude)}, ${str(part.longitude)}`;
        }
        case 'contacts': {
            const first = arr(m.contacts)[0];
            const name = str(rec(first?.name).formatted_name);
            return name !== '' ? `[Contacto] ${name}` : '[Contacto]';
        }
        case 'button':
            return str(rec(m.button).text) || '[Botón]';
        case 'interactive': {
            const i = rec(m.interactive);
            const reply = rec(i.button_reply ?? i.list_reply);
            return str(reply.title) || '[Respuesta]';
        }
        case 'reaction':
            return `[Reacción] ${str(rec(m.reaction).emoji)}`.trim();
        case 'order':
            return '[Pedido]';
        default:
            return '[Mensaje no compatible]';
    }
}

/**
 * Lo que trae un aviso de Meta: mensajes de contactos, estados de lo enviado y
 * cambios de plantillas. Lo demás (cambios de la cuenta, de calidad…) se ignora.
 */
export function parseMetaWebhook(body: unknown): ParsedWebhook {
    const out: ParsedWebhook = { messages: [], statuses: [], templateChanges: 0 };
    const root = rec(body);
    for (const entry of arr(root.entry)) {
        for (const change of arr(entry.changes)) {
            const field = str(change.field);
            const value = rec(change.value);
            if (field === 'message_template_status_update' || field === 'message_template_quality_update' || field === 'template_category_update') {
                out.templateChanges++;
                continue;
            }
            if (field !== 'messages') continue;
            const meta = rec(value.metadata);
            const phoneNumberId = str(meta.phone_number_id);
            const contacts = arr(value.contacts);
            for (const m of arr(value.messages)) {
                const waId = str(m.from).replace(/\D/g, '');
                const id = str(m.id);
                if (waId === '' || id === '') continue;
                const contact = contacts.find((c) => str(c.wa_id).replace(/\D/g, '') === waId) ?? contacts[0];
                const profile = str(rec(contact?.profile).name).trim();
                out.messages.push({
                    phoneNumberId,
                    waId,
                    profileName: profile !== '' ? profile.slice(0, 200) : null,
                    id: id.slice(0, 160),
                    at: when(m.timestamp),
                    type: str(m.type) || 'unknown',
                    text: inboundText(m).slice(0, 4096),
                });
            }
            for (const s of arr(value.statuses)) {
                const id = str(s.id);
                if (id === '') continue;
                out.statuses.push({
                    phoneNumberId,
                    id: id.slice(0, 160),
                    status: str(s.status),
                    at: when(s.timestamp),
                    recipientId: str(s.recipient_id).replace(/\D/g, ''),
                    errors: arr(s.errors).map((e) => ({
                        code: Number.isFinite(Number(e.code)) ? Number(e.code) : null,
                        title: str(e.title),
                        message: str(e.message),
                        details: str(rec(e.error_data).details) || null,
                    })),
                });
            }
        }
    }
    return out;
}
