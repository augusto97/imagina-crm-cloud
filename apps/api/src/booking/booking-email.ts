import { formatBookingWhen, timeZoneLabel } from '@imagina-base/shared';
import { escapeHtml, inkOn, safeColor, type PortalEmail, type PortalEmailBrand } from '../portal/portal-email';

/**
 * D5 — Correos de la agenda al CLIENTE, con la marca de la empresa: la
 * confirmación, la reprogramación, la cancelación y los recordatorios. Puro
 * (sin I/O): lo que se prueba es exactamente lo que sale. Todo lo que escribió
 * la persona o la empresa pasa por `escapeHtml`.
 */

export type BookingMailKind = 'booked' | 'rescheduled' | 'cancelled' | 'reminder';

export interface BookingMailInput {
    kind: BookingMailKind;
    clientName: string;
    service: string;
    staff: string;
    start: string;
    end: string;
    previousStart?: string | null;
    location: string;
    /** Zona de la empresa (los horarios se calculan ahí). */
    companyTz: string;
    /** Zona del cliente (si la mandó el navegador): el horario se le muestra en su reloj. */
    clientTz?: string | null;
    timeFormat: 'h24' | 'h12';
    manageUrl: string;
    cancelUrl: string;
    /** Página de agenda (para volver a reservar tras cancelar). */
    bookUrl?: string | null;
    canReschedule: boolean;
    canCancel: boolean;
    note?: string;
    /** «mañana», «en 1 hora»: sólo en el recordatorio. */
    reminderLead?: string;
    withdrawUrl?: string | null;
    /** Quién canceló o movió: el cliente o la empresa. */
    byTeam?: boolean;
}

/** El horario en el reloj del cliente y, si es otro, también en el de la empresa. */
export function bookingWhenText(iso: string, companyTz: string, clientTz: string | null | undefined, timeFormat: 'h24' | 'h12'): string {
    const tz = clientTz && clientTz !== companyTz ? clientTz : companyTz;
    const main = formatBookingWhen(iso, tz, timeFormat);
    if (tz === companyTz) return main;
    return `${main} (hora de ${timeZoneLabel(tz)}; en ${timeZoneLabel(companyTz)}: ${formatBookingWhen(iso, companyTz, timeFormat, { weekday: false, year: false })})`;
}

function frame(brand: PortalEmailBrand, subject: string, inner: string, footer: string): string {
    const e = escapeHtml;
    const name = brand.name.trim();
    const color = safeColor(brand.color);
    const logo = brand.logoUrl
        ? `<img src="${e(brand.logoUrl)}" alt="${e(name)}" style="max-height:48px;max-width:200px;display:block;margin:0 auto 12px;border:0">`
        : '';
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="height:6px;background:${color};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 8px;text-align:center">${logo}${name ? `<div style="font-size:18px;font-weight:600">${e(name)}</div>` : ''}</td></tr>
<tr><td style="padding:8px 28px 4px;font-size:15px;line-height:1.55">
${inner}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #f0f1f3;font-size:12px;color:#9ca3af">${e(footer)}</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

const SUBJECT_TITLE: Record<BookingMailKind, string> = {
    booked: 'Tu cita está confirmada',
    rescheduled: 'Tu cita cambió de horario',
    cancelled: 'Tu cita fue cancelada',
    reminder: 'Recordatorio de tu cita',
};

export function bookingClientEmail(brand: PortalEmailBrand, i: BookingMailInput): PortalEmail {
    const e = escapeHtml;
    const company = brand.name.trim();
    const color = safeColor(brand.color);
    const ink = inkOn(color);
    const when = bookingWhenText(i.start, i.companyTz, i.clientTz, i.timeFormat);
    const before = i.previousStart ? bookingWhenText(i.previousStart, i.companyTz, i.clientTz, i.timeFormat) : null;
    const service = i.service.trim().slice(0, 120);
    const subject = `${SUBJECT_TITLE[i.kind]}: ${service}${i.kind === 'cancelled' ? '' : `, ${formatBookingWhen(i.start, i.clientTz && i.clientTz !== i.companyTz ? i.clientTz : i.companyTz, i.timeFormat, { year: false })}`}`;
    const hello = i.clientName.trim() ? `Hola, ${i.clientName.trim().slice(0, 80)}:` : 'Hola:';

    const lead: Record<BookingMailKind, string> = {
        booked: `Tu cita${company ? ` con ${company}` : ''} quedó agendada.`,
        rescheduled: i.byTeam ? `${company || 'La empresa'} cambió el horario de tu cita.` : 'Cambiaste el horario de tu cita. Este es el nuevo:',
        cancelled: i.byTeam ? `${company || 'La empresa'} canceló tu cita.` : 'Cancelaste tu cita. Ya no te esperamos en este horario.',
        reminder: `Te recordamos tu cita${i.reminderLead ? ` ${i.reminderLead}` : ''}${company ? ` con ${company}` : ''}.`,
    };

    const rows: Array<[string, string]> = [
        ['Servicio', service],
        ...(i.staff.trim() ? ([['Con', i.staff.trim()]] as Array<[string, string]>) : []),
        [i.kind === 'cancelled' ? 'Era el' : 'Cuándo', when],
        ...(before && i.kind === 'rescheduled' ? ([['Antes era', before]] as Array<[string, string]>) : []),
        ...(i.location.trim() && i.kind !== 'cancelled' ? ([['Dónde', i.location.trim()]] as Array<[string, string]>) : []),
    ];
    const note = i.kind !== 'cancelled' && i.note?.trim() ? i.note.trim().slice(0, 2000) : '';
    const active = i.kind !== 'cancelled';
    const buttons: Array<{ label: string; url: string; primary: boolean }> = [];
    if (active && i.canReschedule) buttons.push({ label: 'Cambiar el horario', url: i.manageUrl, primary: true });
    if (active && i.canCancel) buttons.push({ label: 'Cancelar la cita', url: i.cancelUrl, primary: false });
    if (!active && i.bookUrl) buttons.push({ label: 'Agendar otra cita', url: i.bookUrl, primary: true });

    const footer = `Recibiste este correo porque se agendó una cita${company ? ` con ${company}` : ''} con esta dirección.${active ? ' El archivo adjunto la agrega a tu calendario.' : ''}`;
    const text = [
        hello,
        '',
        lead[i.kind],
        '',
        ...rows.map(([k, v]) => `${k}: ${v}`),
        ...(note ? ['', note] : []),
        ...buttons.flatMap((b) => ['', `${b.label}: ${b.url}`]),
        ...(i.withdrawUrl ? ['', 'Si quieres retirar la autorización para el tratamiento de tus datos personales:', i.withdrawUrl] : []),
        '',
        footer,
    ].join('\n');

    const rowsHtml = rows
        .map(
            ([k, v]) =>
                `<tr><td style="padding:8px 12px 8px 0;font-size:13px;color:#6b7280;vertical-align:top;white-space:nowrap">${e(k)}</td><td style="padding:8px 0;font-size:15px;color:#111827">${k === 'Antes era' ? `<s style="color:#9ca3af">${e(v)}</s>` : e(v)}</td></tr>`,
        )
        .join('');
    const buttonsHtml = buttons
        .map((b) =>
            b.primary
                ? `<a href="${e(b.url)}" style="display:inline-block;background:${color};color:${ink};text-decoration:none;font-weight:600;padding:11px 20px;border-radius:8px;margin:4px">${e(b.label)}</a>`
                : `<a href="${e(b.url)}" style="display:inline-block;background:#ffffff;color:#374151;border:1px solid #d1d5db;text-decoration:none;font-weight:600;padding:10px 20px;border-radius:8px;margin:4px">${e(b.label)}</a>`,
        )
        .join('');
    const inner = `<p style="margin:0 0 12px">${e(hello)}</p>
<p style="margin:0 0 16px">${e(lead[i.kind])}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-top:1px solid #f0f1f3;border-bottom:1px solid #f0f1f3">${rowsHtml}</table>
${note ? `<p style="margin:0 0 16px;white-space:pre-wrap">${e(note)}</p>` : ''}
${buttonsHtml ? `<p style="margin:8px 0 16px;text-align:center">${buttonsHtml}</p>` : ''}
${i.withdrawUrl ? `<p style="margin:16px 0 0;padding-top:12px;border-top:1px solid #f0f1f3;font-size:12px;color:#6b7280">Aceptaste la autorización para el tratamiento de tus datos personales. Si cambias de opinión, puedes retirarla desde <a href="${e(i.withdrawUrl)}" style="color:#6b7280">este enlace</a>.</p>` : ''}`;
    return { subject, text, html: frame(brand, subject, inner, footer) };
}
