import { SIGNATURE_STATUS_LABELS, SIGNER_STATUS_LABELS, type SignatureRequestStatus, type SignerStatus } from '@imagina-base/shared';
import { inlineScriptHash, inlineScriptText } from '../forms/form-page';
import { escapeHtml } from '../portal/portal-email';

/**
 * Páginas públicas de verificación de una firma (ADR-S107). HTML del
 * servidor, todo escapado, sin estilos ni scripts de afuera.
 *
 * v0.1.447 — «Comprobar un archivo»: el navegador calcula la huella SHA-256
 * del PDF que la persona elige (el archivo nunca sale de su equipo) y la
 * compara con la de la firma; en la página general, pregunta de qué firma es.
 * El resultado lo dibuja el script en la página: nunca viaja en la dirección,
 * así nadie puede mandar un enlace que diga «tu archivo coincide» sin que la
 * persona lo haya comprobado.
 */

export interface VerifyInfo {
    found: boolean;
    title?: string;
    company?: string;
    status?: SignatureRequestStatus;
    original_sha256?: string;
    signed_sha256?: string | null;
    completed_at?: string | null;
    signers?: Array<{ name: string; role: string; signed_at: string | null; status: SignerStatus }>;
    formatWhen?: (iso: string) => string;
}

export const VERIFY_BASE = '/api/v1/public/sign';

/**
 * Script único de las dos páginas. Constante (sin datos adentro): los datos
 * van en atributos `data-*`, así su hash en la CSP no cambia nunca.
 */
export const VERIFY_SCRIPT = `(function(){
var f=document.getElementById('vf');var out=document.getElementById('vr');if(!f||!out)return;
function say(cls,html){out.className='res '+cls;out.innerHTML=html;}
function esc(t){return String(t).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
if(!window.crypto||!crypto.subtle){say('r','Este navegador no puede calcular la huella. Prueba con otro navegador actualizado.');f.disabled=true;return;}
f.addEventListener('change',function(){
var file=f.files&&f.files[0];if(!file)return;
if(file.size>104857600){say('r','El archivo pesa más de 100 MB: no es un documento de esta firma.');return;}
say('m','Calculando la huella de «'+esc(file.name)+'»…');
file.arrayBuffer().then(function(buf){return crypto.subtle.digest('SHA-256',buf);}).then(function(d){
var hex=Array.prototype.map.call(new Uint8Array(d),function(b){return ('0'+b.toString(16)).slice(-2);}).join('');
var mode=f.getAttribute('data-mode');
if(mode==='compare'){
var o=f.getAttribute('data-original')||'',s=f.getAttribute('data-signed')||'';
if(s&&hex===s)say('g','<strong>Coincide con el PDF firmado.</strong> Es exactamente el documento que firmaron estas personas.');
else if(o&&hex===o)say('a','<strong>Es el documento original, antes de firmar.</strong> El contenido es el mismo, pero este archivo no trae las firmas.');
else say('r','<strong>No coincide.</strong> Este archivo no es el documento de esta firma o fue modificado después de firmarse.');
return;}
return fetch('${VERIFY_BASE}/verify-hash',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sha256:hex})}).then(function(r){
if(r.status===429)throw new Error('busy');return r.json();}).then(function(j){
var x=j&&j.data;
if(!x||!x.found){say('r','<strong>No encontramos ninguna firma con este archivo.</strong> Si lo modificaron después de firmarlo, la huella cambia y ya no coincide.');return;}
var link='<a href="${VERIFY_BASE}/verify/'+encodeURIComponent(x.code)+'">Ver quién firmó y cuándo</a>';
if(x.which==='signed')say('g','<strong>Es un documento firmado.</strong> «'+esc(x.title)+'»'+(x.company?' de '+esc(x.company):'')+'. '+link);
else say('a','<strong>Es el documento original de una firma, antes de firmar.</strong> «'+esc(x.title)+'»'+(x.company?' de '+esc(x.company):'')+'. '+link);
});
}).catch(function(e){say('r',e&&e.message==='busy'?'Demasiados intentos. Vuelve a probar en unos minutos.':'No se pudo leer el archivo.');});
});
})();`;

export const VERIFY_SCRIPT_HASH = inlineScriptHash(VERIFY_SCRIPT);

/** CSP de las páginas de verificación: sólo el script de arriba y pedidos al mismo servidor. */
export function verifyCsp(): string {
    return `default-src 'none'; style-src 'unsafe-inline'; script-src '${VERIFY_SCRIPT_HASH}'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
}

const STYLE = `body{margin:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827}main{max-width:620px;margin:32px auto;padding:0 16px}.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px}.card+.card{margin-top:14px}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0 0 6px}.muted{color:#6b7280;font-size:14px}.ok{display:inline-block;padding:3px 10px;border-radius:999px;font-size:13px;font-weight:600}.g{background:#dcfce7;color:#166534}.a{background:#fef3c7;color:#92400e}.r{background:#fee2e2;color:#991b1b}.m{background:#f3f4f6;color:#374151}table{width:100%;border-collapse:collapse;margin-top:16px;font-size:14px}td{padding:8px 0;border-top:1px solid #f0f1f3;vertical-align:top}td:first-child{color:#6b7280;width:38%;padding-right:12px}code{font-size:12px;word-break:break-all}ul{padding-left:18px;margin:6px 0}a{color:#0e7490}.pick{display:block;margin-top:10px;padding:14px;border:1px dashed #cbd5e1;border-radius:10px;background:#f8fafc;font-size:14px}.pick input{display:block;margin-top:8px;max-width:100%}.res{margin-top:12px;padding:10px 12px;border-radius:10px;font-size:14px;line-height:1.45}.res:empty{display:none}form.code{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}form.code input{flex:1;min-width:160px;padding:9px 11px;border:1px solid #cbd5e1;border-radius:8px;font-size:15px;text-transform:uppercase;letter-spacing:.04em}form.code button{padding:9px 16px;border:0;border-radius:8px;background:#0e7490;color:#fff;font-size:14px;font-weight:600;cursor:pointer}`;

function page(title: string, body: string, withScript: boolean): string {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}<p class="muted" style="text-align:center;margin-top:14px">Firma electrónica simple (Ley 527 de 1999 y Decreto 2364 de 2012).</p></main>${
        withScript ? `<script>${inlineScriptText(VERIFY_SCRIPT)}</script>` : ''
    }</body></html>`;
}

function picker(attrs: string, text: string): string {
    return `<label class="pick">${text}<input id="vf" type="file" accept="application/pdf,.pdf" ${attrs}></label><div id="vr" class="res" role="status" aria-live="polite"></div>`;
}

/** La página de una firma (por su código), con «Comprobar un archivo». */
export function verifyPage(info: VerifyInfo): string {
    const e = escapeHtml;
    if (!info.found) {
        return page(
            'Verificar una firma',
            `<div class="card"><h1>No encontramos esa firma</h1><p class="muted">El código no existe o la solicitud ya no está disponible. Revisa que lo hayas escrito igual que en la constancia (por ejemplo ABCDE-23456).</p><p><a href="${VERIFY_BASE}/verify">Verificar con el archivo o con otro código</a></p></div>`,
            false,
        );
    }
    const status = info.status!;
    const tone = status === 'completed' ? 'g' : status === 'pending' ? 'a' : 'r';
    const when = (v: string | null | undefined) => (v && info.formatWhen ? info.formatWhen(v) : '—');
    const signers = (info.signers ?? [])
        .map((s) => `<li>${e(s.name)}${s.role ? ` <span class="muted">(${e(s.role)})</span>` : ''} — ${s.status === 'signed' ? `firmó el ${e(when(s.signed_at))}` : e(SIGNER_STATUS_LABELS[s.status].toLowerCase())}</li>`)
        .join('');
    const original = /^[0-9a-f]{64}$/.test(info.original_sha256 ?? '') ? info.original_sha256! : '';
    const signed = /^[0-9a-f]{64}$/.test(info.signed_sha256 ?? '') ? info.signed_sha256! : '';
    return page(
        'Verificar una firma',
        `<div class="card"><h1>${e(info.title ?? '')}</h1><p class="muted">${e(info.company ?? '')}</p>
<p><span class="ok ${tone}">${e(SIGNATURE_STATUS_LABELS[status])}</span></p>
<table>
<tr><td>Personas</td><td><ul>${signers}</ul></td></tr>
${info.completed_at ? `<tr><td>Firmado por todos</td><td>${e(when(info.completed_at))}</td></tr>` : ''}
<tr><td>Huella SHA-256 del original</td><td><code>${e(info.original_sha256 ?? '')}</code></td></tr>
${info.signed_sha256 ? `<tr><td>Huella SHA-256 del PDF firmado</td><td><code>${e(info.signed_sha256)}</code></td></tr>` : ''}
</table></div>
<div class="card"><h2>Comprobar un archivo</h2><p class="muted">Elige el PDF que te mandaron y te decimos si es el que se firmó. La huella se calcula en tu equipo: el archivo no se sube a ningún lado. Si cambió una sola letra, no coincide.</p>
${picker(`data-mode="compare" data-original="${original}" data-signed="${signed}"`, 'Elige el PDF')}
<p class="muted" style="margin-top:12px"><a href="${VERIFY_BASE}/verify">Verificar otro documento</a></p></div>`,
        true,
    );
}

/** La página general: un código o el archivo. */
export function verifyLookupPage(): string {
    return page(
        'Verificar un documento firmado',
        `<div class="card"><h1>Verificar un documento firmado</h1><p class="muted">Comprueba quién firmó un documento y que nadie lo haya cambiado después.</p>
<h2 style="margin-top:18px">Con el archivo</h2><p class="muted">La huella del PDF se calcula en tu equipo: el archivo no se sube a ningún lado.</p>
${picker('data-mode="lookup"', 'Elige el PDF firmado')}
<h2 style="margin-top:22px">Con el código de verificación</h2><p class="muted">Está en la constancia, al final del documento firmado (por ejemplo ABCDE-23456).</p>
<form class="code" method="get" action="${VERIFY_BASE}/verify"><input name="code" autocomplete="off" maxlength="16" placeholder="ABCDE-23456" aria-label="Código de verificación" required><button type="submit">Verificar</button></form></div>`,
        true,
    );
}
