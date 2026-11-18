import { frame } from '../booking/booking-email';
import { escapeHtml, inkOn, safeColor, type PortalEmail, type PortalEmailBrand } from '../portal/portal-email';

/**
 * D6 (v0.1.446) — Correos de la firma electrónica, con la marca de la empresa.
 * Puros (sin I/O). Todo lo que escribió la empresa o quien firma pasa por
 * `escapeHtml`; los enlaces los arma el servidor.
 */

export type SignatureMailKind = 'request' | 'reminder' | 'completed' | 'voided' | 'declined';

export interface SignatureMailInput {
    kind: SignatureMailKind;
    signerName: string;
    title: string;
    /** Mensaje que escribió quien pidió la firma (sólo en el pedido y el recordatorio). */
    message?: string;
    /** Quién lo envió (nombre de la persona). */
    requestedBy?: string | null;
    /** Enlace personal para firmar (o para bajar el firmado). */
    url: string;
    /** «hasta el 30 de noviembre de 2026». */
    expiresText?: string;
    /** Anulado: el motivo; rechazado: quién y por qué. */
    reason?: string | null;
    declinedBy?: string | null;
    /** Firmado: el PDF va adjunto (si no, sólo el enlace). */
    attached?: boolean;
}

const SUBJECT: Record<SignatureMailKind, string> = {
    request: 'Tienes un documento para firmar',
    reminder: 'Recordatorio: falta tu firma',
    completed: 'Documento firmado',
    voided: 'Se anuló la solicitud de firma',
    declined: 'No se completó la firma',
};

function button(url: string, label: string, color: string): string {
    const e = escapeHtml;
    return `<p style="margin:8px 0 18px;text-align:center"><a href="${e(url)}" style="display:inline-block;background:${color};color:${inkOn(color)};text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">${e(label)}</a></p>`;
}

export function signatureEmail(brand: PortalEmailBrand, i: SignatureMailInput): PortalEmail {
    const e = escapeHtml;
    const company = brand.name.trim();
    const color = safeColor(brand.color);
    const title = i.title.trim().slice(0, 160) || 'Documento';
    const subject = `${SUBJECT[i.kind]}: ${title}`;
    const hello = i.signerName.trim() ? `Hola, ${i.signerName.trim().slice(0, 80)}:` : 'Hola:';
    const who = i.requestedBy?.trim() ? `${i.requestedBy.trim()}${company ? ` (${company})` : ''}` : company || 'Una empresa';
    const message = (i.message ?? '').trim().slice(0, 2000);

    const lead: Record<SignatureMailKind, string> = {
        request: `${who} te envió «${title}» para que lo firmes electrónicamente. Lo puedes leer completo antes de firmar; firmar toma un minuto y no necesitas crear una cuenta.`,
        reminder: `Todavía falta tu firma en «${title}», que te envió ${who}.`,
        completed: `Todas las personas firmaron «${title}». ${i.attached ? 'Te adjuntamos el documento firmado, con la constancia de las firmas al final.' : 'Puedes bajar el documento firmado, con la constancia de las firmas al final.'}`,
        voided: `${company || 'La empresa'} anuló la solicitud de firma de «${title}». El enlace que recibiste ya no sirve y no tienes que hacer nada.`,
        declined: `La firma de «${title}» no se completó${i.declinedBy?.trim() ? `: ${i.declinedBy.trim()} decidió no firmar` : ''}. El enlace que recibiste ya no sirve.`,
    };
    const action: Record<SignatureMailKind, string | null> = {
        request: 'Revisar y firmar',
        reminder: 'Revisar y firmar',
        completed: 'Descargar el documento firmado',
        voided: null,
        declined: null,
    };
    const reason = i.kind === 'voided' || i.kind === 'declined' ? (i.reason ?? '').trim().slice(0, 500) : '';
    const footer =
        i.kind === 'request' || i.kind === 'reminder'
            ? `Este enlace es personal: no lo reenvíes.${i.expiresText ? ` Vence ${i.expiresText}.` : ''} Si no esperabas este documento, puedes ignorar este correo.`
            : 'Firma electrónica simple (Ley 527 de 1999 y Decreto 2364 de 2012).';

    const text = [
        hello,
        '',
        lead[i.kind],
        ...(message && (i.kind === 'request' || i.kind === 'reminder') ? ['', message] : []),
        ...(reason ? ['', `Motivo: ${reason}`] : []),
        ...(action[i.kind] ? ['', `${action[i.kind]}: ${i.url}`] : []),
        '',
        footer,
    ].join('\n');

    const inner = `<p style="margin:0 0 12px">${e(hello)}</p>
<p style="margin:0 0 16px">${e(lead[i.kind])}</p>
${message && (i.kind === 'request' || i.kind === 'reminder') ? `<p style="margin:0 0 16px;padding:10px 14px;border-left:3px solid ${color};background:#f9fafb;white-space:pre-wrap">${e(message)}</p>` : ''}
${reason ? `<p style="margin:0 0 16px;color:#374151"><strong>Motivo:</strong> ${e(reason)}</p>` : ''}
${action[i.kind] ? button(i.url, action[i.kind]!, color) : ''}`;
    return { subject, text, html: frame(brand, subject, inner, footer) };
}

/** El código de 6 números para firmar (va en el asunto: se lee desde la notificación del teléfono). */
export function signatureCodeEmail(brand: PortalEmailBrand, i: { code: string; minutes: number; title: string }): PortalEmail {
    const e = escapeHtml;
    const code = /^\d{6}$/.test(i.code) ? i.code : '';
    const company = brand.name.trim();
    const subject = `${code} es tu código para firmar${company ? ` con ${company}` : ''}`;
    const lead = `Escribe este código en la página de firma de «${i.title.trim().slice(0, 160) || 'Documento'}» para confirmar que eres tú.`;
    const footer = `Vence en ${i.minutes} minutos. Si no fuiste tú, ignora este correo: sin el código nadie puede firmar con tu nombre.`;
    const text = ['Hola:', '', lead, '', code, '', footer].join('\n');
    const inner = `<p style="margin:0 0 12px">Hola:</p>
<p style="margin:0 0 16px">${e(lead)}</p>
<p style="margin:8px 0 20px;text-align:center"><span style="display:inline-block;font-size:30px;font-weight:700;letter-spacing:8px;padding:12px 20px;border-radius:10px;background:#f3f4f6;color:#111827;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace">${e(code)}</span></p>`;
    return { subject, text, html: frame(brand, subject, inner, footer) };
}
