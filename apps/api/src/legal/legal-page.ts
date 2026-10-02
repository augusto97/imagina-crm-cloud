/**
 * Render de las páginas públicas de la plataforma (v0.1.247): inicio,
 * privacidad y condiciones. Puro y testeado.
 *
 * Son HTML SERVIDO por el API (no por el SPA) a propósito: los revisores y
 * crawlers de Google comprueban que la página principal enlace a la política
 * de privacidad, y no todos ejecutan JavaScript. Todo el texto se escapa; el
 * único marcado que se respeta es el markdown mínimo de la plantilla, y los
 * enlaces sólo con `https:` o `mailto:`.
 */

export function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Negrita, enlaces y correos sobre texto YA escapado. */
function inline(escaped: string): string {
    return escaped
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(((?:https:\/\/|mailto:)[^\s)]+)\)/g, '<a href="$2" rel="noopener">$1</a>')
        .replace(
            /(^|[\s(])([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})(?=$|[\s).,;])/g,
            '$1<a href="mailto:$2">$2</a>',
        );
}

/** Markdown mínimo: `## título`, `- ítem`, párrafos y saltos de línea. */
export function renderLegalMarkdown(md: string): string {
    const out: string[] = [];
    let list: string[] = [];
    let para: string[] = [];
    const flushList = () => {
        if (list.length) out.push(`<ul>${list.map((li) => `<li>${li}</li>`).join('')}</ul>`);
        list = [];
    };
    const flushPara = () => {
        if (para.length) out.push(`<p>${para.join('<br>')}</p>`);
        para = [];
    };
    for (const raw of md.replace(/\r\n/g, '\n').split('\n')) {
        const line = raw.trimEnd();
        if (line.trim() === '') {
            flushList();
            flushPara();
            continue;
        }
        const h = /^#{2,3}\s+(.+)$/.exec(line);
        if (h) {
            flushList();
            flushPara();
            out.push(`<h2>${inline(escapeHtml(h[1]!.trim()))}</h2>`);
            continue;
        }
        const li = /^\s*[-*]\s+(.+)$/.exec(line);
        if (li) {
            flushPara();
            list.push(inline(escapeHtml(li[1]!.trim())));
            continue;
        }
        flushList();
        para.push(inline(escapeHtml(line.trim())));
    }
    flushList();
    flushPara();
    return out.join('\n');
}

export interface LegalPageInput {
    kind: 'home' | 'privacy' | 'terms';
    appName: string;
    company: string;
    email: string;
    appUrl: string;
    websiteUrl: string;
    urls: { home: string; privacy: string; terms: string };
    /** Markdown ya con los marcadores resueltos. */
    body: string;
    updated: string;
}

const TITLES: Record<LegalPageInput['kind'], string> = {
    home: '',
    privacy: 'Política de privacidad',
    terms: 'Condiciones del servicio',
};

export function renderLegalPage(p: LegalPageInput): string {
    const app = escapeHtml(p.appName);
    const title = p.kind === 'home' ? app : `${TITLES[p.kind]} · ${app}`;
    const nav = [
        p.kind === 'home' ? `<span>Inicio</span>` : `<a href="${escapeHtml(p.urls.home)}">Inicio</a>`,
        p.kind === 'privacy' ? `<span>Privacidad</span>` : `<a href="${escapeHtml(p.urls.privacy)}">Política de privacidad</a>`,
        p.kind === 'terms' ? `<span>Condiciones</span>` : `<a href="${escapeHtml(p.urls.terms)}">Condiciones del servicio</a>`,
    ].join(' · ');
    const hero =
        p.kind === 'home'
            ? `<header class="hero"><h1>${app}</h1><p class="lead">Bases de datos, vistas y automatizaciones para tu empresa.</p><p><a class="btn" href="${escapeHtml(p.appUrl)}">Entrar a ${app}</a></p></header>`
            : `<header><p class="crumb"><a href="${escapeHtml(p.urls.home)}">${app}</a></p><h1>${escapeHtml(TITLES[p.kind])}</h1></header>`;
    const footerParts = [
        p.company ? escapeHtml(p.company) : '',
        p.email ? `<a href="mailto:${escapeHtml(p.email)}">${escapeHtml(p.email)}</a>` : '',
        p.websiteUrl ? `<a href="${escapeHtml(p.websiteUrl)}" rel="noopener">${escapeHtml(p.websiteUrl.replace(/^https:\/\//, ''))}</a>` : '',
    ].filter(Boolean);
    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${escapeHtml(TITLES[p.kind] || `${p.appName}: bases de datos, vistas y automatizaciones para empresas`)}">
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1f2328;--muted:#5b6470;--line:#e4e7eb;--accent:#0b7a8f}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--fg:#e6e6e6;--muted:#a3a3a3;--line:#2b2b2b;--accent:#4fc3d6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 20px 24px}
h1{font-size:2rem;line-height:1.2;margin:.2em 0 .4em}h2{font-size:1.2rem;margin:1.8em 0 .4em}
p,li{color:var(--fg)}ul{padding-left:1.3em}a{color:var(--accent)}
.lead{font-size:1.15rem;color:var(--muted);margin:0 0 1.2em}.crumb{margin:0;color:var(--muted);font-size:.9rem}
.btn{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:.6em 1.2em;border-radius:8px;font-weight:600}
.hero{padding-bottom:12px;border-bottom:1px solid var(--line)}nav{font-size:.92rem;color:var(--muted);margin-top:40px;padding-top:16px;border-top:1px solid var(--line)}
footer{font-size:.85rem;color:var(--muted);margin-top:8px}.updated{font-size:.85rem;color:var(--muted)}
</style>
</head>
<body>
<main>
${hero}
<article>
${renderLegalMarkdown(p.body)}
</article>
<nav>${nav}</nav>
<footer>${footerParts.join(' · ')}</footer>
</main>
</body>
</html>`;
}
