import { escapeHtml, inkOn, safeColor, type PortalEmail, type PortalEmailBrand } from '../portal/portal-email';

/**
 * v0.1.289 — Correos de los formularios a QUIEN RESPONDE, con la marca de la
 * empresa (mismo patrón que `portal-email.ts`): la confirmación del correo
 * (doble opt-in) y la copia de sus respuestas.
 *
 * Puro (sin I/O): lo que se prueba es exactamente lo que sale. Todo lo que
 * escribió la persona o la empresa pasa por `escapeHtml`.
 */

export interface FormAnswerLine {
    question: string;
    answer: string;
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

/** «Confirma tu respuesta»: el botón lleva a la página que crea el registro. */
export function formConfirmEmail(brand: PortalEmailBrand, url: string, opts: { formTitle: string }): PortalEmail {
    const e = escapeHtml;
    const name = brand.name.trim();
    const title = opts.formTitle.trim().slice(0, 120);
    const color = safeColor(brand.color);
    const ink = inkOn(color);
    const subject = title ? `Confirma tu respuesta a «${title}»` : 'Confirma tu respuesta';
    const who = name || 'Quien te envió el formulario';
    const footer = `Recibiste este correo porque alguien completó un formulario${name ? ` de ${name}` : ''} con esta dirección. Si no fuiste tú, ignóralo: sin confirmar no se guarda nada.`;
    const text = [
        'Hola,',
        '',
        `Para terminar de enviar tu respuesta${title ? ` a «${title}»` : ''}, confirma que este correo es tuyo con este enlace:`,
        url,
        '',
        'El enlace vence en 48 horas y se usa una sola vez.',
        '',
        footer,
    ].join('\n');
    const inner = `<p style="margin:0 0 12px">Hola,</p>
<p style="margin:0 0 20px">${e(who)} recibió tu respuesta${title ? ` a «${e(title)}»` : ''}. Para terminar de enviarla, confirma que este correo es tuyo.</p>
<p style="margin:0 0 20px;text-align:center"><a href="${e(url)}" style="display:inline-block;background:${color};color:${ink};text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px">Confirmar mi correo</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#6b7280">El enlace vence en 48 horas y se usa una sola vez. Si el botón no funciona, copia esta dirección en el navegador:</p>
<p style="margin:0 0 20px;font-size:12px;color:#6b7280;word-break:break-all">${e(url)}</p>`;
    return { subject, text, html: frame(brand, subject, inner, footer) };
}

/** Copia de las respuestas a quien respondió: cada pregunta con su respuesta legible. */
export function formCopyEmail(brand: PortalEmailBrand, opts: { formTitle: string; answers: FormAnswerLine[] }): PortalEmail {
    const e = escapeHtml;
    const name = brand.name.trim();
    const title = opts.formTitle.trim().slice(0, 120);
    const subject = title ? `Copia de tu respuesta a «${title}»` : 'Copia de tu respuesta';
    const answers = opts.answers
        .slice(0, 80)
        .map((a) => ({ question: a.question.slice(0, 300), answer: a.answer.replace(/\r\n/g, '\n').slice(0, 5000) }));
    const footer = `Te mandamos esta copia porque completaste un formulario${name ? ` de ${name}` : ''}. No hace falta que respondas este correo.`;
    const text = [
        'Hola,',
        '',
        `Esta es una copia de lo que respondiste${title ? ` en «${title}»` : ''}:`,
        '',
        ...answers.flatMap((a) => [`${a.question}:`, a.answer || '—', '']),
        footer,
    ].join('\n');
    const rows = answers
        .map(
            (a) => `<tr><td style="padding:10px 0;border-bottom:1px solid #f0f1f3">
<div style="font-size:12px;color:#6b7280;margin-bottom:2px">${e(a.question)}</div>
<div style="font-size:15px;color:#111827;white-space:pre-wrap">${a.answer ? e(a.answer) : '<span style="color:#9ca3af">—</span>'}</div>
</td></tr>`,
        )
        .join('\n');
    const inner = `<p style="margin:0 0 12px">Hola,</p>
<p style="margin:0 0 16px">Esta es una copia de lo que respondiste${title ? ` en «${e(title)}»` : ''}:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px">${rows}</table>`;
    return { subject, text, html: frame(brand, subject, inner, footer) };
}
