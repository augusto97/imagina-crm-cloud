import type { PaypalPayPage } from './collections.service';

/**
 * v0.1.372 — Las páginas del link de PayPal que no son PayPal: ya pagado,
 * vencido, anulado, cancelaste, en revisión… Servidas por el API, sin
 * scripts y con todo escapado. Llevan el nombre de la empresa (no el de la
 * plataforma) y un botón para volver a intentar cuando tiene sentido.
 */

function esc(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function money(amount: number, currency: string): string {
    const c = currency.toUpperCase();
    const noCents = ['COP', 'CLP', 'PYG', 'JPY', 'HUF', 'TWD'].includes(c);
    const n = new Intl.NumberFormat('es-CO', { minimumFractionDigits: noCents ? 0 : 2, maximumFractionDigits: noCents ? 0 : 2 }).format(amount);
    return `${n} ${c}`;
}

const TEXT: Record<PaypalPayPage['state'], { title: string; body: string }> = {
    paid: { title: 'Este cobro ya está pagado', body: 'Ya recibimos el pago de {what}. No tienes que hacer nada más.' },
    paid_now: { title: '¡Pago recibido!', body: 'Tu pago de {what} quedó confirmado. Gracias. Puedes cerrar esta página.' },
    refunded: { title: 'Este cobro fue reembolsado', body: 'El pago de {what} se devolvió. Si tienes dudas, escríbele a {company}.' },
    expired: { title: 'Este link de pago venció', body: 'El link para pagar {what} ya no sirve. Pídele uno nuevo a {company}.' },
    cancelled: { title: 'Este cobro fue anulado', body: '{company} anuló el link para pagar {what}. Si crees que es un error, escríbele.' },
    cancelled_by_payer: { title: 'Cancelaste el pago', body: 'No se te cobró nada. Si quieres pagar {what}, vuelve a intentarlo.' },
    not_found: { title: 'No encontramos este link de pago', body: 'El enlace no es válido. Si te lo enviaron para pagar, pídele uno nuevo a quien te lo mandó.' },
    unavailable: { title: 'Este link de pago no está disponible', body: 'Por ahora no se puede pagar {what} con este link. Escríbele a {company}.' },
    error: { title: 'No pudimos abrir PayPal', body: 'PayPal no respondió a tiempo. Prueba de nuevo en unos minutos.' },
    failed: { title: 'PayPal no aprobó el pago', body: 'No se te cobró {what}. Puedes volver a intentarlo con otro medio de pago.' },
    review: { title: 'Tu pago está en revisión', body: 'PayPal recibió tu pago de {what} y lo está confirmando. Te avisarán cuando quede listo.' },
    confirming: { title: 'Estamos confirmando tu pago', body: 'Si completaste el pago de {what} en PayPal, en unos minutos queda confirmado. Si no lo completaste, puedes volver a intentarlo.' },
};

export function renderPaypalPayPage(page: PaypalPayPage): string {
    const t = TEXT[page.state];
    const company = page.company ? esc(page.company) : 'la empresa';
    const what =
        page.title && page.amount !== null && page.currency
            ? `«${esc(page.title)}» por ${esc(money(page.amount, page.currency))}`
            : page.title
              ? `«${esc(page.title)}»`
              : 'este cobro';
    const body = esc(t.body).replace('{what}', what).replace('{company}', company);
    const note = page.message ? `<p class="note">${esc(page.message)}</p>` : '';
    const retry = page.retryUrl && /^https?:\/\//.test(page.retryUrl) ? `<a class="btn" href="${esc(page.retryUrl)}">Volver a intentar con PayPal</a>` : '';
    const brand = page.company ? `<p class="brand">${esc(page.company)}</p>` : '';
    const ok = page.state === 'paid' || page.state === 'paid_now';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(t.title)}</title><style>
body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f6f7f9;color:#0f172a;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:16px;box-sizing:border-box}
main{max-width:460px;width:100%;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px;box-shadow:0 10px 30px -18px rgba(15,23,42,.35);box-sizing:border-box}
h1{font-size:20px;margin:0 0 10px}p{margin:0;line-height:1.55;color:#334155}.brand{font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#64748b;margin-bottom:12px}
.note{margin-top:12px;font-size:14px;color:#64748b}.mark{width:44px;height:44px;border-radius:999px;display:flex;align-items:center;justify-content:center;margin-bottom:14px;font-size:22px;background:${ok ? '#dcfce7' : '#f1f5f9'};color:${ok ? '#15803d' : '#475569'}}
.btn{display:inline-block;margin-top:20px;background:#0070ba;color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:999px}
.btn:focus-visible{outline:3px solid #93c5fd;outline-offset:2px}
@media (prefers-color-scheme:dark){body{background:#121212;color:#f1f5f9}main{background:#1c1c1c;border-color:#2b2b2b}p{color:#cbd5e1}.note{color:#94a3b8}.mark{background:${ok ? '#14532d' : '#262626'};color:${ok ? '#86efac' : '#cbd5e1'}}}
</style></head><body><main>${brand}<div class="mark" aria-hidden="true">${ok ? '✓' : 'i'}</div><h1>${esc(t.title)}</h1><p>${body}</p>${note}${retry}</main></body></html>`;
}
