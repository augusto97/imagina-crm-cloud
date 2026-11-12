import { escapeHtml, inkOn, safeColor, type PortalEmailBrand } from '../portal/portal-email';

/**
 * v0.1.412 (ADR-S103) — El correo que recibe quien compra: el detalle del
 * pedido, cómo pagarlo (las instrucciones que escribió la empresa) y el
 * enlace para verlo. Con la marca de la empresa, nunca la de la plataforma.
 * Todo texto de la empresa o del cliente va escapado.
 */

export interface ShopOrderEmailInput {
    brand: PortalEmailBrand;
    shopName: string;
    number: string;
    customerName: string;
    lines: Array<{ title: string; qty: number; subtotal: string }>;
    subtotal: string;
    /** v0.1.415 — El descuento del cupón ya formateado («-$ 10.000») y su código. */
    discount?: string | null;
    couponCode?: string;
    shipping: string | null;
    total: string;
    delivery: string;
    paymentLabel: string;
    paymentInstructions: string;
    /**
     * v0.1.413 — Qué correo es: `placed` el pedido (pago por fuera),
     * `awaiting` el pedido en línea que todavía no se pagó (el botón lleva a
     * pagar) y `paid` cuando entra el pago en línea.
     */
    stage?: 'placed' | 'awaiting' | 'paid';
    /** v0.1.416 — Los archivos para descargar (con el pedido pagado). */
    downloads?: Array<{ title: string; name: string; url: string }>;
    /** v0.1.416 — Cuándo llegan o hasta cuándo sirven las descargas. */
    downloadsNote?: string | null;
    orderUrl: string | null;
    sellerLine: string;
}

export interface ShopOrderEmail {
    subject: string;
    html: string;
    text: string;
}

function paragraphs(s: string): string {
    return s
        .split(/\n{2,}/)
        .map((p) => `<p style="margin:0 0 10px">${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
        .join('');
}

export function shopOrderEmail(o: ShopOrderEmailInput): ShopOrderEmail {
    const e = escapeHtml;
    const color = safeColor(o.brand.color);
    const ink = inkOn(color);
    const name = o.brand.name.trim() || o.shopName;
    const stage = o.stage ?? 'placed';
    const subject = (
        stage === 'paid' ? `Recibimos el pago de tu pedido ${o.number}` : stage === 'awaiting' ? `Completa el pago de tu pedido ${o.number}` : `Recibimos tu pedido ${o.number}`
    ).slice(0, 200);
    const intro = stage === 'paid' ? 'Recibimos el pago de tu pedido' : stage === 'awaiting' ? 'Apartamos tu pedido' : 'Recibimos tu pedido';
    const buttonLabel = stage === 'awaiting' ? 'Pagar mi pedido' : 'Ver mi pedido';
    const logo = o.brand.logoUrl
        ? `<img src="${e(o.brand.logoUrl)}" alt="${e(name)}" style="max-height:48px;max-width:200px;display:block;margin:0 auto 12px;border:0">`
        : '';
    const rows = o.lines
        .map(
            (l) =>
                `<tr><td style="padding:8px 0;border-bottom:1px solid #f0f1f3">${e(String(l.qty))} × ${e(l.title)}</td><td style="padding:8px 0;border-bottom:1px solid #f0f1f3;text-align:right;white-space:nowrap">${e(l.subtotal)}</td></tr>`,
        )
        .join('');
    const totals = [
        `<tr><td style="padding:6px 0;color:#6b7280">Subtotal</td><td style="padding:6px 0;text-align:right">${e(o.subtotal)}</td></tr>`,
        o.discount
            ? `<tr><td style="padding:6px 0;color:#15803d">Descuento${o.couponCode ? ` · ${e(o.couponCode)}` : ''}</td><td style="padding:6px 0;text-align:right;color:#15803d">${e(o.discount)}</td></tr>`
            : '',
        `<tr><td style="padding:6px 0;color:#6b7280">Entrega · ${e(o.delivery)}</td><td style="padding:6px 0;text-align:right">${e(o.shipping ?? 'Sin costo')}</td></tr>`,
        `<tr><td style="padding:8px 0;font-weight:700;font-size:16px">Total</td><td style="padding:8px 0;text-align:right;font-weight:700;font-size:16px">${e(o.total)}</td></tr>`,
    ].join('');
    const downloads = o.downloads ?? [];
    const dlBlock =
        downloads.length > 0 || o.downloadsNote
            ? `<div style="margin:18px 0 0;padding:14px 16px;background:#f5f3ff;border:1px solid #ede9fe;border-radius:10px">
<p style="margin:0 0 8px;font-weight:600">${downloads.length > 0 ? 'Tus descargas' : 'Descargas'}</p>
${downloads
    .map(
        (d) =>
            `<p style="margin:0 0 8px"><a href="${e(d.url)}" style="color:${color};font-weight:600;text-decoration:none">⬇ ${e(d.name)}</a><br><span style="color:#6b7280;font-size:13px">${e(d.title)}</span></p>`,
    )
    .join('')}
${o.downloadsNote ? `<p style="margin:0;color:#6b7280;font-size:13px">${e(o.downloadsNote)}</p>` : ''}
</div>`
            : '';
    const button = o.orderUrl
        ? `<p style="margin:20px 0 6px;text-align:center"><a href="${e(o.orderUrl)}" style="display:inline-block;background:${color};color:${ink};text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">${buttonLabel}</a></p>`
        : '';
    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="height:6px;background:${color};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 8px;text-align:center">${logo}<div style="font-size:18px;font-weight:600">${e(name)}</div></td></tr>
<tr><td style="padding:8px 28px 4px;font-size:15px;line-height:1.55">
<p style="margin:0 0 6px;font-size:20px;font-weight:700">¡Gracias, ${e(o.customerName.split(/\s+/)[0] ?? o.customerName)}!</p>
<p style="margin:0 0 16px;color:#4b5563">${intro} <strong>${e(o.number)}</strong>.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">${rows}${totals}</table>
<div style="margin:18px 0 0;padding:14px 16px;background:#f8fafc;border:1px solid #eef0f3;border-radius:10px">
<p style="margin:0 0 8px;font-weight:600">${e(o.paymentLabel)}</p>
${paragraphs(o.paymentInstructions)}
</div>
${dlBlock}
${button}
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #f0f1f3;font-size:12px;color:#9ca3af">${e(o.sellerLine)}</td></tr>
</table></td></tr></table>
</body></html>`;
    const text = [
        `¡Gracias, ${o.customerName}!`,
        `${intro} ${o.number}.`,
        '',
        ...o.lines.map((l) => `${l.qty} × ${l.title} — ${l.subtotal}`),
        '',
        `Subtotal: ${o.subtotal}`,
        ...(o.discount ? [`Descuento${o.couponCode ? ` (${o.couponCode})` : ''}: ${o.discount}`] : []),
        `Entrega (${o.delivery}): ${o.shipping ?? 'Sin costo'}`,
        `Total: ${o.total}`,
        '',
        o.paymentLabel,
        o.paymentInstructions,
        ...(downloads.length > 0 ? ['', 'Tus descargas:', ...downloads.map((d) => `${d.name} (${d.title}): ${d.url}`)] : []),
        ...(o.downloadsNote ? [o.downloadsNote] : []),
        ...(o.orderUrl ? ['', `${stage === 'awaiting' ? 'Paga tu pedido' : 'Ver tu pedido'}: ${o.orderUrl}`] : []),
        '',
        o.sellerLine,
    ].join('\n');
    return { subject, html, text };
}

/**
 * v0.1.416 — «Mis pedidos»: el enlace para ver los pedidos de un correo en la
 * tienda. Sólo llega si ese correo tiene pedidos (la página responde lo mismo
 * en los dos casos: no sirve para averiguar quién compró).
 */
export function shopMyOrdersEmail(o: { brand: PortalEmailBrand; shopName: string; url: string; days: number; sellerLine: string }): ShopOrderEmail {
    const e = escapeHtml;
    const color = safeColor(o.brand.color);
    const ink = inkOn(color);
    const name = o.brand.name.trim() || o.shopName;
    const subject = `Tus pedidos en ${name}`.slice(0, 200);
    const logo = o.brand.logoUrl
        ? `<img src="${e(o.brand.logoUrl)}" alt="${e(name)}" style="max-height:48px;max-width:200px;display:block;margin:0 auto 12px;border:0">`
        : '';
    const days = o.days === 1 ? '1 día' : `${o.days} días`;
    const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${e(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td style="height:6px;background:${color};font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:28px 28px 8px;text-align:center">${logo}<div style="font-size:18px;font-weight:600">${e(name)}</div></td></tr>
<tr><td style="padding:8px 28px 4px;font-size:15px;line-height:1.55">
<p style="margin:0 0 6px;font-size:20px;font-weight:700">Tus pedidos</p>
<p style="margin:0 0 16px;color:#4b5563">Toca el botón para ver tus pedidos en ${e(o.shopName)}, cómo van y tus descargas. El enlace sirve ${e(days)}.</p>
<p style="margin:20px 0 6px;text-align:center"><a href="${e(o.url)}" style="display:inline-block;background:${color};color:${ink};text-decoration:none;font-weight:600;padding:12px 22px;border-radius:8px">Ver mis pedidos</a></p>
<p style="margin:16px 0 0;color:#9ca3af;font-size:13px">Si no lo pediste tú, ignora este correo.</p>
</td></tr>
<tr><td style="padding:16px 28px 24px;border-top:1px solid #f0f1f3;font-size:12px;color:#9ca3af">${e(o.sellerLine)}</td></tr>
</table></td></tr></table>
</body></html>`;
    const text = [`Tus pedidos en ${o.shopName}`, '', `Míralos aquí (el enlace sirve ${days}): ${o.url}`, '', 'Si no lo pediste tú, ignora este correo.', '', o.sellerLine].join('\n');
    return { subject, html, text };
}
