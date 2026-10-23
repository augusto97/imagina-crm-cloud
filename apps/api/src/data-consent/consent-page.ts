import { escapeHtml } from '../forms/form-page';
import type { WithdrawLanding } from './data-consent.service';

/**
 * Páginas del enlace para RETIRAR una autorización de tratamiento de datos
 * (las sirve el API: el titular no tiene cuenta). Con la marca de la empresa
 * y todo escapado. La de llegada NO retira nada: los escáneres de correo abren
 * los enlaces con GET, así que retirar es un botón (POST) y, a diferencia de la
 * confirmación del correo, no se envía solo — es una decisión de la persona.
 */

const NEUTRAL = { company: '', accent: '#475467', logoUrl: null as string | null };

function inkOn(hex: string): string {
    const ch = (i: number): number => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    const l = 0.2126 * ch(1) + 0.7152 * ch(3) + 0.0722 * ch(5);
    return l > 0.45 ? '#1d2330' : '#ffffff';
}

const CSS = `
  :root { --accent: #0e7490; --accent-ink: #fff; --bg: #f4f5f7; --card: #fff; --fg: #1d2330; --muted: #667085; --border: #d9dde5; --danger: #c0262d; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--fg); font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 620px; margin: 0 auto; padding: 32px 16px 48px; }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 1px 2px rgba(16,24,40,.04), 0 6px 24px rgba(16,24,40,.06); overflow: hidden; }
  .band { height: 6px; background: var(--accent); }
  .inner { padding: 28px; }
  @media (max-width: 520px) { .inner { padding: 22px 18px; } .wrap { padding: 16px 10px 32px; } }
  .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 18px; color: var(--muted); font-size: 14px; font-weight: 600; }
  .brand img { max-height: 36px; max-width: 160px; object-fit: contain; }
  h1 { font-size: 22px; line-height: 1.3; margin: 0 0 10px; }
  p { margin: 0 0 12px; }
  .muted { color: var(--muted); font-size: 14px; }
  .facts { border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin: 14px 0; font-size: 14px; }
  .facts div { display: flex; gap: 8px; padding: 3px 0; }
  .facts dt { color: var(--muted); min-width: 130px; }
  .facts dd { margin: 0; font-weight: 500; }
  details { margin: 14px 0; }
  summary { cursor: pointer; color: var(--accent); font-weight: 600; font-size: 14px; }
  .text { white-space: pre-wrap; font-size: 13px; line-height: 1.55; border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px;
          max-height: 320px; overflow: auto; margin-top: 8px; background: #fafbfc; }
  .btn { appearance: none; border: 0; border-radius: 8px; padding: 11px 22px; font: inherit; font-weight: 600; min-height: 44px; cursor: pointer;
         background: var(--danger); color: #fff; }
  .notice { border-radius: 10px; padding: 12px 14px; margin: 14px 0; font-size: 14px; background: rgba(14,116,144,.07); }
  .ok { width: 52px; height: 52px; border-radius: 50%; background: var(--accent); color: var(--accent-ink); display: inline-flex; align-items: center; justify-content: center; font-size: 26px; margin-bottom: 12px; }
`;

function shell(title: string, brand: WithdrawLanding['brand'] | null, body: string): string {
    const b = brand ?? NEUTRAL;
    const accent = /^#[0-9a-fA-F]{6}$/.test(b.accent) ? b.accent : '#0e7490';
    const e = escapeHtml;
    const head = b.logoUrl
        ? `<div class="brand"><img src="${e(b.logoUrl)}" alt="${e(b.company)}"></div>`
        : b.company
          ? `<div class="brand">${e(b.company)}</div>`
          : '';
    return `<!doctype html>
<html lang="es"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><meta name="robots" content="noindex" />
<title>${e(title)}</title>
<style>${CSS}
  :root { --accent: ${accent}; --accent-ink: ${inkOn(accent)}; }
</style></head>
<body><div class="wrap"><div class="card"><div class="band"></div><div class="inner" data-testid="consent-withdraw-page">
${head}
${body}
</div></div></div></body></html>`;
}

function facts(l: WithdrawLanding): string {
    const e = escapeHtml;
    return `<dl class="facts">
<div><dt>Responsable</dt><dd>${e(l.company)}</dd></div>
<div><dt>Aceptada el</dt><dd>${e(l.acceptedAt)}</dd></div>
<div><dt>Desde</dt><dd>${e(l.sourceLabel)}</dd></div>
<div><dt>Versión del texto</dt><dd>${l.version}</dd></div>
</dl>${l.text ? `<details><summary>Ver el texto que aceptaste</summary><div class="text">${e(l.text)}</div></details>` : ''}`;
}

/** Página de llegada: qué autorización es y el botón para retirarla. */
export function renderWithdrawLanding(l: WithdrawLanding, action: string): string {
    const e = escapeHtml;
    if (l.withdrawnAt) return renderWithdrawResult('already', l);
    const intro =
        l.kind === 'pending'
            ? `<p>Todavía no confirmaste tu respuesta. Si retiras ahora tu autorización, la respuesta se descarta y <strong>no se guarda ningún dato</strong>.</p>`
            : `<p>Puedes retirar en cualquier momento la autorización que le diste a <strong>${e(l.company)}</strong> para tratar tus datos personales (Ley 1581 de 2012).</p>`;
    const after =
        l.kind === 'pending'
            ? ''
            : `<p class="muted">Retirarla no borra tus datos de forma automática: ${e(l.company)} recibe el aviso y debe atender tu decisión.${
                  l.contactEmail ? ` Si además quieres que supriman tus datos, escríbeles a ${e(l.contactEmail)}.` : ''
              }</p>`;
    return shell(
        'Retirar tu autorización de datos',
        l.brand,
        `<h1>Retirar tu autorización de datos personales</h1>
${intro}
${facts(l)}
${after}
<form method="post" action="${e(action)}"><button type="submit" class="btn" data-testid="consent-withdraw-submit">Retirar mi autorización</button></form>`,
    );
}

export function renderWithdrawResult(status: 'withdrawn' | 'already' | 'discarded', l: WithdrawLanding | null): string {
    const e = escapeHtml;
    const company = l?.company ?? 'la empresa';
    if (status === 'discarded') {
        return shell(
            'Autorización retirada',
            l?.brand ?? null,
            `<div class="ok" aria-hidden="true">✓</div><h1>Listo: tu respuesta no se guardó</h1>
<p>Retiraste tu autorización antes de confirmar el formulario, así que descartamos tu respuesta. ${e(company)} no recibió tus datos.</p>`,
        );
    }
    if (status === 'already') {
        return shell(
            'Autorización retirada',
            l?.brand ?? null,
            `<h1>Ya habías retirado esta autorización</h1>
<p>La retiraste el ${e(l?.withdrawnAt ?? '')}. No hace falta hacer nada más.</p>
${l ? facts(l) : ''}
${l?.contactEmail ? `<p class="muted">Para consultas sobre tus datos, escríbele a ${e(company)}: ${e(l.contactEmail)}.</p>` : ''}`,
        );
    }
    return shell(
        'Autorización retirada',
        l?.brand ?? null,
        `<div class="ok" aria-hidden="true">✓</div><h1>Retiramos tu autorización</h1>
<p>Le avisamos a ${e(company)} que retiraste tu autorización para tratar tus datos personales${l?.withdrawnAt ? ` (${e(l.withdrawnAt)})` : ''}.</p>
<div class="notice">Esto no borra tus datos de forma automática: ${e(company)} debe atender tu decisión.${
            l?.contactEmail ? ` Si además quieres que los supriman, escríbeles a ${e(l.contactEmail)}.` : ''
        }</div>`,
    );
}

export function renderWithdrawInvalid(): string {
    return shell(
        'Enlace no válido',
        null,
        `<h1>Este enlace no es válido</h1>
<p>Puede que esté incompleto o mal copiado. Si quieres retirar tu autorización de datos personales, escríbele directamente a la empresa.</p>`,
    );
}
