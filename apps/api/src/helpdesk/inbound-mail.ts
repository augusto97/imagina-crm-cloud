import { messageIdList, normalizeMessageId, type RichDoc } from '@imagina-base/shared';
import { simpleParser, type AddressObject, type ParsedMail } from 'mailparser';
import { htmlToRichDoc, textToRichDoc } from './mail-html';

/**
 * D2 — Un correo entrante, ya leído: quién lo manda, a qué hilo pertenece,
 * si es una respuesta automática, su cuerpo y sus adjuntos. El parseo del
 * MIME lo hace `mailparser`; lo demás (detectar respuestas automáticas,
 * cortar el historial citado de una respuesta) es PURO y está testeado.
 */

export interface InboundAttachment {
    filename: string;
    contentType: string;
    size: number;
    content: Buffer;
}

export interface InboundMail {
    messageId: string | null;
    inReplyTo: string | null;
    references: string[];
    /** El remitente (From). */
    from: { email: string; name: string } | null;
    /** A quién se le responde: Reply-To si lo trae (formularios web), si no From. */
    customer: { email: string; name: string } | null;
    to: string;
    cc: string;
    subject: string;
    date: Date | null;
    /** Texto plano (el que trae el correo o el derivado del HTML). */
    text: string;
    html: string | null;
    /** Por qué NO es un correo de una persona (respuesta automática, rebote), o null. */
    autoReason: string | null;
    /** Lo mandó esta app (lleva nuestra cabecera): nunca crea tickets. */
    fromHelpdesk: boolean;
    attachments: InboundAttachment[];
}

/** Cabecera que va en cada respuesta que sale desde la mesa de ayuda (anti-bucle). */
export const HELPDESK_HEADER = 'X-Imagina-Helpdesk';

type HeaderGetter = (name: string) => string;

function firstAddress(a: AddressObject | AddressObject[] | undefined): { email: string; name: string } | null {
    const list = Array.isArray(a) ? a.flatMap((x) => x.value) : (a?.value ?? []);
    for (const v of list) {
        const email = (v.address ?? '').trim().toLowerCase();
        if (email !== '' && email.includes('@')) return { email, name: (v.name ?? '').trim() };
    }
    return null;
}

function addressText(a: AddressObject | AddressObject[] | undefined): string {
    const list = Array.isArray(a) ? a.flatMap((x) => x.value) : (a?.value ?? []);
    return list
        .map((v) => (v.address ?? '').trim().toLowerCase())
        .filter((v) => v !== '')
        .slice(0, 25)
        .join(', ');
}

function headerText(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(headerText).join(', ');
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'object') {
        const v = value as { value?: unknown; text?: unknown };
        if (typeof v.text === 'string') return v.text;
        if (typeof v.value === 'string') return v.value;
    }
    return String(value);
}

const AUTO_SUBJECT =
    /^\s*(?:auto(?:matic)?[\s-]*(?:reply|response)|autoreply|respuesta autom[aá]tica|réponse automatique|out of (?:the )?office|fuera de (?:la )?oficina|delivery status notification|undeliverable|undelivered mail|mail delivery (?:failed|subsystem)|returned mail|no se (?:puede|pudo) entregar|mensaje no entregado|auto:)/i;
const BOUNCE_SENDER = /^(?:mailer-daemon|postmaster|mail-daemon)@/i;

/**
 * ¿Es una respuesta automática, un rebote o un envío masivo? Devuelve el
 * motivo en lenguaje claro (para el panel), o null si parece de una persona.
 * Lo que mira (RFC 3834 y las cabeceras que de verdad usan Gmail, Outlook y
 * los autorespondedores): `Auto-Submitted`, `Precedence`, `X-Autoreply`,
 * `X-Autorespond`, `X-Auto-Response-Suppress`, el remitente de rebotes
 * (mailer-daemon, postmaster), el `Return-Path` vacío, un informe de entrega
 * (`multipart/report`) y los asuntos típicos de «fuera de la oficina».
 */
export function autoReplyReason(get: HeaderGetter, fromEmail: string | null, subject: string): string | null {
    const autoSubmitted = get('auto-submitted').trim().toLowerCase();
    if (autoSubmitted !== '' && autoSubmitted !== 'no') return 'Es una respuesta automática (Auto-Submitted).';
    const precedence = get('precedence').trim().toLowerCase();
    if (/^(bulk|junk|list|auto_reply|auto-reply)\b/.test(precedence)) return 'Es un envío masivo o automático (Precedence).';
    if (get('x-autoreply') !== '' || get('x-autorespond') !== '' || get('x-auto-response') !== '') return 'Es una respuesta automática.';
    if (/\b(all|oof|autoreply)\b/i.test(get('x-auto-response-suppress'))) return 'Es una respuesta automática (fuera de la oficina).';
    if (fromEmail && BOUNCE_SENDER.test(fromEmail)) return 'Es un aviso de correo no entregado (rebote).';
    if (/^\s*<\s*>\s*$/.test(get('return-path'))) return 'Es un aviso automático sin remitente (rebote).';
    if (/multipart\/report/i.test(get('content-type'))) return 'Es un informe de entrega (rebote).';
    if (AUTO_SUBJECT.test(subject)) return 'Parece una respuesta automática (por el asunto).';
    return null;
}

/**
 * Corta el historial citado de una respuesta («El lun., … escribió:», el
 * «-----Mensaje original-----» de Outlook, las líneas con «>» al final). Si
 * cortar deja vacío, devuelve el texto entero: nunca se pierde lo que mandó
 * el cliente.
 */
export function stripQuotedReply(text: string): string {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    let cut = lines.length;
    for (let i = 0; i < lines.length; i++) {
        const l = lines[i]!.trim();
        const two = `${l} ${(lines[i + 1] ?? '').trim()}`;
        if (/^(?:El|On|Le|Am)\s.{4,200}(?:escribió|wrote|a écrit|schrieb)\s*:$/i.test(l) || /^(?:El|On)\s.{4,200}(?:escribió|wrote)\s*:$/i.test(two)) {
            cut = i;
            break;
        }
        if (/^-{2,}\s*(?:original message|mensaje original|forwarded message|mensaje reenviado)\s*-{2,}$/i.test(l)) {
            cut = i;
            break;
        }
        if (/^_{8,}$/.test(l)) {
            cut = i;
            break;
        }
        if (/^(?:De|From)\s*:\s*\S/.test(l)) {
            const next = lines.slice(i + 1, i + 4).map((x) => x.trim());
            if (next.some((x) => /^(?:Enviado|Sent|Fecha|Date|Para|To|Asunto|Subject)\s*:/i.test(x))) {
                cut = i;
                break;
            }
        }
    }
    let kept = lines.slice(0, cut);
    // Las líneas citadas con «>» al final (y los blancos que las rodean).
    while (kept.length > 0 && (/^\s*>/.test(kept[kept.length - 1]!) || kept[kept.length - 1]!.trim() === '')) kept.pop();
    kept = kept.filter((l, i, arr) => !(l.trim() === '' && (arr[i - 1] ?? '').trim() === ''));
    const out = kept.join('\n').trim();
    return out !== '' ? out : text.trim();
}

/** Lee el MIME crudo. Los adjuntos quedan en memoria (el tamaño ya se acotó antes). */
export async function parseInbound(source: Buffer): Promise<InboundMail> {
    const parsed: ParsedMail = await simpleParser(source, {
        skipTextToHtml: true,
        skipTextLinks: true,
        skipImageLinks: true,
        maxHtmlLengthToParse: 2_000_000,
    });
    const get: HeaderGetter = (name) => headerText(parsed.headers.get(name));
    const from = firstAddress(parsed.from);
    const replyTo = firstAddress(parsed.replyTo);
    const subject = (parsed.subject ?? '').replace(/\s+/g, ' ').trim();
    const html = typeof parsed.html === 'string' && parsed.html.trim() !== '' ? parsed.html : null;
    const text = (parsed.text ?? '').trim();
    const refs = messageIdList(parsed.references ?? '');
    return {
        messageId: normalizeMessageId(parsed.messageId),
        inReplyTo: messageIdList(parsed.inReplyTo ?? '')[0] ?? null,
        references: refs,
        from,
        customer: replyTo ?? from,
        to: addressText(parsed.to),
        cc: addressText(parsed.cc),
        subject,
        date: parsed.date instanceof Date && !Number.isNaN(parsed.date.getTime()) ? parsed.date : null,
        text,
        html,
        autoReason: autoReplyReason(get, from?.email ?? null, subject),
        fromHelpdesk: get(HELPDESK_HEADER.toLowerCase()) !== '',
        attachments: parsed.attachments
            .filter((a) => !a.related && a.contentDisposition !== 'inline' && a.content && a.content.length > 0)
            .slice(0, 20)
            .map((a) => ({
                filename: (a.filename ?? '').trim() || 'adjunto',
                contentType: a.contentType || 'application/octet-stream',
                size: a.size ?? a.content.length,
                content: a.content,
            })),
    };
}

/** La descripción de un ticket nuevo: el HTML saneado o, si no hay, el texto. */
export function bodyToRichDoc(mail: Pick<InboundMail, 'html' | 'text'>): RichDoc | null {
    if (mail.html) {
        const doc = htmlToRichDoc(mail.html);
        if (doc) return doc;
    }
    return mail.text !== '' ? textToRichDoc(mail.text) : null;
}
