/**
 * v0.1.245 — el correo con el enlace de acceso al portal, con la MARCA de la
 * empresa (white-label): su nombre en el asunto y el remitente, su logo y su
 * color en el cuerpo. Nada de la plataforma: el cliente final no tiene por qué
 * saber qué herramienta usa la empresa.
 *
 * Puro (sin I/O): lo que se prueba es exactamente lo que sale.
 */

export interface PortalEmailBrand {
    /** Nombre que ve el cliente: el nombre de app elegido o el de la empresa. */
    name: string;
    /** Color primario (#rrggbb) o null → gris neutro. */
    color: string | null;
    /** URL ABSOLUTA del logo (firmada) o null. */
    logoUrl: string | null;
}

export interface PortalEmail {
    subject: string;
    text: string;
    html: string;
}

const NEUTRAL = '#1f2937';

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Sólo un hex de 6 dígitos llega al CSS del correo (nada de inyección de estilos). */
function safeColor(color: string | null): string {
    return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : NEUTRAL;
}

/** Tinta legible sobre el color del botón (luminancia WCAG). */
function inkOn(hex: string): string {
    const channel = (i: number) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const l = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
    return l > 0.45 ? '#111827' : '#ffffff';
}

/**
 * Nombre visible seguro para el remitente: sin saltos de línea (inyección de
 * cabeceras) ni comillas/ángulos, acotado. El transporte lo codifica.
 */
export function senderName(name: string): string {
    return name.replace(/[\r\n"<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function portalAccessEmail(
    brand: PortalEmailBrand,
    url: string,
    opts: { allAccounts?: boolean } = {},
): PortalEmail {
    const name = brand.name.trim() !== '' ? brand.name.trim() : 'tu portal';
    const color = safeColor(brand.color);
    const ink = inkOn(color);
    const subject = opts.allAccounts ? 'Tu acceso a todas tus cuentas' : `Tu acceso al portal de ${name}`;
    const intro = opts.allAccounts
        ? 'Con este enlace ves en un solo lugar todas las cuentas que tienes en portales de clientes.'
        : `${name} te dio acceso a su portal de clientes.`;
    const footer = opts.allAccounts
        ? 'Recibiste este correo porque pediste ver todas tus cuentas. Si no fuiste tú, ignóralo.'
        : `Recibiste este correo porque ${name} te dio acceso a su portal. Si no lo esperabas, ignóralo.`;

    const text = [
        'Hola,',
        '',
        intro,
        'Entra con este enlace (vale por 24 horas y se usa una sola vez):',
        url,
        '',
        footer,
    ].join('\n');

    const e = escapeHtml;
    const logo = brand.logoUrl
        ? `<img src="${e(brand.logoUrl)}" alt="${e(name)}" style="max-height:48px;max-width:200px;display:block;margin:0 auto 12px;border:0">`
        : '';
    const heading = opts.allAccounts ? 'Tus cuentas' : e(name);
    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="height:6px;background:${color};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 8px;text-align:center">${logo}<div style="font-size:18px;font-weight:600">${heading}</div></td></tr>
<tr><td style="padding:8px 28px 4px;font-size:15px;line-height:1.55">
<p style="margin:0 0 12px">Hola,</p>
<p style="margin:0 0 20px">${e(intro)}</p>
<p style="margin:0 0 20px;text-align:center"><a href="${e(url)}" style="display:inline-block;background:${color};color:${ink};text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px">Entrar al portal</a></p>
<p style="margin:0 0 8px;font-size:13px;color:#6b7280">El enlace vale por 24 horas y se usa una sola vez. Si el botón no funciona, copia esta dirección en el navegador:</p>
<p style="margin:0 0 20px;font-size:12px;color:#6b7280;word-break:break-all">${e(url)}</p>
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #f0f1f3;font-size:12px;color:#9ca3af">${e(footer)}</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
    return { subject, text, html };
}
