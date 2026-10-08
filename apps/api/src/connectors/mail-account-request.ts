import { randomBytes } from 'node:crypto';
import type { MailAccountIntegration } from '@imagina-base/shared';
import type { MailMessage } from '../mail/mail.types';
import { emailList, type IntegrationRequest } from './integration-calls';

/**
 * El correo de la EMPRESA por su cuenta de Google o Microsoft (v0.1.249,
 * ADR-S29). PURO, como `buildIntegrationRequest`: los tests verifican la
 * petición exacta sin salir a la red, y el envío real usa esta misma función.
 *
 * Gmail recibe el mensaje RFC 2822 entero (en base64url); Graph, un objeto
 * `message`. En los dos el REMITENTE es la cuenta conectada: si el mensaje
 * pedía otro (`from` de una automatización), esa dirección pasa a
 * «responder a» — Gmail reescribiría el From en silencio y Graph lo rechaza
 * con `ErrorSendAsDenied`, así que es la única forma de que se comporte igual
 * en las dos y de que la persona sepa qué va a pasar.
 */

export interface AccountMailParts {
    to: string[];
    cc: string[];
    bcc: string[];
    replyTo: string | null;
}

/** Destinatarios y responder-a ya validados. Lanza si no hay destinatario válido. */
export function accountMailParts(message: MailMessage, address: string | null): AccountMailParts {
    const to = emailList(message.to ?? '');
    if (to.length === 0) throw new Error(`«${(message.to ?? '').trim() || '(vacío)'}» no es un correo válido.`);
    const own = (address ?? '').trim().toLowerCase();
    const wantedFrom = (message.from ?? '').trim();
    const explicitReply = (message.replyTo ?? '').trim();
    // Un `from` distinto de la cuenta no se puede respetar: queda como responder-a.
    const replyTo =
        explicitReply !== ''
            ? explicitReply
            : wantedFrom !== '' && wantedFrom.toLowerCase() !== own
              ? wantedFrom
              : '';
    return {
        to,
        cc: emailList(message.cc ?? ''),
        bcc: emailList(message.bcc ?? ''),
        replyTo: emailList(replyTo)[0] ?? null,
    };
}

/** Quita lo que permitiría inyectar cabeceras (saltos de línea, control). */
function headerSafe(value: string): string {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim();
}

function mimeWord(text: string): string {
    return /^[\x20-\x7e]*$/.test(text) ? text : `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`;
}

function b64Body(text: string): string {
    return Buffer.from(text, 'utf8')
        .toString('base64')
        .replace(/.{1,76}/g, (chunk) => `${chunk}\r\n`)
        .trimEnd();
}

/** Texto plano de respaldo cuando el mensaje trae sólo HTML. */
export function htmlToText(html: string): string {
    return html
        .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/li|\/tr)\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Mensaje RFC 2822 para Gmail. Con HTML va `multipart/alternative` con el
 * texto plano de respaldo (sin él, varios filtros de spam penalizan).
 */
export function buildAccountRfc2822(
    message: MailMessage,
    parts: AccountMailParts,
    address: string | null,
    boundary = `imb_${randomBytes(12).toString('hex')}`,
): string {
    const lines: string[] = [];
    const name = headerSafe(message.fromName ?? '').replace(/"/g, "'");
    if (address) lines.push(`From: ${name !== '' ? `${mimeWord(`"${name}"`)} ` : ''}<${address}>`);
    lines.push(`To: ${parts.to.join(', ')}`);
    if (parts.cc.length > 0) lines.push(`Cc: ${parts.cc.join(', ')}`);
    if (parts.bcc.length > 0) lines.push(`Bcc: ${parts.bcc.join(', ')}`);
    if (parts.replyTo) lines.push(`Reply-To: ${parts.replyTo}`);
    lines.push(`Subject: ${mimeWord(headerSafe(message.subject ?? ''))}`);
    lines.push('MIME-Version: 1.0');
    const html = message.html ?? '';
    const text = message.text ?? (html !== '' ? htmlToText(html) : '');
    const files = message.attachments ?? [];
    // v0.1.266 — con adjuntos, el cuerpo va dentro de un multipart/mixed.
    const mixed = `${boundary}_m`;
    if (files.length > 0) lines.push(`Content-Type: multipart/mixed; boundary="${mixed}"`, '', `--${mixed}`);
    if (html === '') {
        lines.push('Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '', b64Body(text));
    } else {
        lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`, '');
        for (const [type, body] of [
            ['text/plain', text],
            ['text/html', html],
        ] as const) {
            lines.push(
                `--${boundary}`,
                `Content-Type: ${type}; charset="UTF-8"`,
                'Content-Transfer-Encoding: base64',
                '',
                b64Body(body),
            );
        }
        lines.push(`--${boundary}--`);
    }
    if (files.length > 0) {
        for (const f of files) {
            const name = mimeWord(headerSafe(f.filename).replace(/"/g, "'"));
            lines.push(
                `--${mixed}`,
                `Content-Type: ${headerSafe(f.contentType)}; name="${name}"`,
                `Content-Disposition: attachment; filename="${name}"`,
                'Content-Transfer-Encoding: base64',
                '',
                f.contentBase64.replace(/.{1,76}/g, (chunk) => `${chunk}\r\n`).trimEnd(),
            );
        }
        lines.push(`--${mixed}--`);
    }
    return lines.join('\r\n');
}

/** Graph envía el mensaje en UN pedido de hasta 4 MB: los adjuntos tienen que entrar. */
export const GRAPH_MAX_ATTACHMENT_BASE64 = 3 * 1024 * 1024;

export function buildAccountMailRequest(
    integration: MailAccountIntegration,
    message: MailMessage,
    accessToken: string,
    address: string | null,
): IntegrationRequest {
    const parts = accountMailParts(message, address);
    const headers = {
        'content-type': 'application/json',
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
    };
    if (integration === 'gmail') {
        const raw = buildAccountRfc2822(message, parts, address);
        return {
            url: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
            method: 'POST',
            headers,
            body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url') }),
        };
    }
    const attachedB64 = (message.attachments ?? []).reduce((n, a) => n + a.contentBase64.length, 0);
    if (attachedB64 > GRAPH_MAX_ATTACHMENT_BASE64) {
        throw new Error(
            'Outlook no acepta adjuntos de más de 3 MB por esta vía: achicá el PDF (imágenes más livianas) o enviá desde el SMTP de la empresa.',
        );
    }
    const list = (emails: string[]): Array<{ emailAddress: { address: string } }> =>
        emails.map((a) => ({ emailAddress: { address: a } }));
    const html = message.html ?? '';
    return {
        url: 'https://graph.microsoft.com/v1.0/me/sendMail',
        method: 'POST',
        headers,
        body: JSON.stringify({
            message: {
                subject: headerSafe(message.subject ?? ''),
                body: html !== '' ? { contentType: 'HTML', content: html } : { contentType: 'Text', content: message.text ?? '' },
                toRecipients: list(parts.to),
                ...(parts.cc.length > 0 ? { ccRecipients: list(parts.cc) } : {}),
                ...(parts.bcc.length > 0 ? { bccRecipients: list(parts.bcc) } : {}),
                ...(parts.replyTo ? { replyTo: list([parts.replyTo]) } : {}),
                ...(message.attachments?.length
                    ? {
                          attachments: message.attachments.map((a) => ({
                              '@odata.type': '#microsoft.graph.fileAttachment',
                              name: headerSafe(a.filename),
                              contentType: a.contentType,
                              contentBytes: a.contentBase64,
                          })),
                      }
                    : {}),
            },
            saveToSentItems: true,
        }),
    };
}

/** Cuántos destinatarios cuenta el proveedor para este mensaje. */
export function accountRecipientCount(parts: AccountMailParts): number {
    return new Set([...parts.to, ...parts.cc, ...parts.bcc].map((a) => a.toLowerCase())).size;
}

export interface AccountMailFailure {
    message: string;
    /** El proveedor frenó por límite: no se reintenta. */
    limit: boolean;
}

function parseJson(body: string): Record<string, unknown> | null {
    try {
        const v: unknown = JSON.parse(body);
        return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}

/**
 * ¿Salió? Traduce los errores de Gmail y Graph a algo que la persona pueda
 * resolver. `null` = enviado.
 */
export function readAccountMailResponse(
    integration: MailAccountIntegration,
    status: number,
    body: string,
): AccountMailFailure | null {
    if (status >= 200 && status < 300) return null;
    const who = integration === 'gmail' ? 'Google' : 'Microsoft';
    const json = parseJson(body);
    const err = (json?.error ?? null) as Record<string, unknown> | string | null;
    const detail =
        err && typeof err === 'object'
            ? String(err.message ?? '')
            : typeof err === 'string'
              ? err
              : '';
    const code = err && typeof err === 'object' ? String(err.code ?? '') : '';
    const reasons =
        err && typeof err === 'object' && Array.isArray(err.errors)
            ? (err.errors as Array<Record<string, unknown>>).map((e) => String(e.reason ?? ''))
            : [];
    const text = `${code} ${detail} ${reasons.join(' ')}`;

    if (
        status === 429 ||
        /daily ?limit|dailyLimitExceeded|rateLimitExceeded|userRateLimitExceeded|quota|ErrorExceededMessageLimit|MessageSubmissionBlocked|sending limit/i.test(text)
    ) {
        return {
            limit: true,
            message:
                `${who} frenó el envío: la cuenta llegó a su límite de correos. ` +
                'Vuelve a habilitarse sola (hasta 24 horas). Si pasa seguido, usá una cuenta con más cupo o un servidor SMTP.',
        };
    }
    if (status === 401) {
        return {
            limit: false,
            message: `La autorización de la cuenta de ${who} venció o se revocó: reconectala en Ajustes → Integraciones.`,
        };
    }
    if (/insufficient|scope|ErrorAccessDenied|AccessDenied/i.test(text) || status === 403) {
        if (/SendAsDenied/i.test(text)) {
            return { limit: false, message: 'Microsoft no deja mandar con otro remitente desde esta cuenta.' };
        }
        return {
            limit: false,
            message: `${who} no deja enviar con esta conexión (falta el permiso de enviar correo o lo bloqueó el administrador de la cuenta). Reconectala en Ajustes → Integraciones.${detail ? ` (${detail})` : ''}`,
        };
    }
    if (/MailboxNotEnabledForRESTAPI|mail service not enabled|failedPrecondition/i.test(text)) {
        return {
            limit: false,
            message: `La cuenta conectada no tiene un buzón de correo habilitado en ${who}.`,
        };
    }
    if (/invalid ?to|invalidArgument|ErrorInvalidRecipients|Invalid To header/i.test(text)) {
        return { limit: false, message: `${who} rechazó un destinatario: ${detail || 'dirección inválida'}.` };
    }
    return { limit: false, message: `${who} rechazó el correo: ${detail || `HTTP ${status}`}` };
}
