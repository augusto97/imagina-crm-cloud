/**
 * XML mínimo para leer y escribir planillas.
 *
 * Al LEER, un .xlsx es contenido de terceros: el lector no resuelve DTDs ni
 * entidades propias (el ataque "billion laughs" y las entidades externas
 * viven ahí). Ningún archivo de Excel, Sheets, LibreOffice o Numbers trae
 * un `<!DOCTYPE`: si aparece, el archivo se rechaza en vez de interpretarse.
 */
import { XlsxError } from './errors';

// ── Escribir ────────────────────────────────────────────────────────────

/**
 * Texto apto para un nodo o un atributo XML: escapa `& < > "` y QUITA los
 * caracteres que XML 1.0 no admite (controles salvo TAB/LF/CR, U+FFFE/FFFF y
 * surrogates sueltos) — un solo carácter así y Excel dice que el archivo está
 * dañado. `_xHHHH_` es un escape propio de OOXML: si el texto lo trae literal,
 * se protege el `_` para que Excel no lo convierta en otro carácter.
 */
export function xmlEscape(text: string): string {
    return text
        // eslint-disable-next-line no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
        .replace(/_(x[0-9A-Fa-f]{4}_)/g, '_x005F_$1')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Leer ────────────────────────────────────────────────────────────────

export interface XmlHandlers {
    /** Apertura de un elemento (`selfClosing`: `<x/>`). El nombre llega SIN prefijo (`x:c` → `c`). */
    open?(name: string, attrs: Record<string, string>, selfClosing: boolean): void;
    close?(name: string): void;
    /**
     * Texto entre etiquetas, CRUDO (con las entidades sin resolver): quien lo
     * necesita llama a `decodeEntities` — así no se paga el costo en los
     * miles de espacios entre etiquetas que nadie mira.
     */
    text?(raw: string): void;
}

const ATTR_RE = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Recorre un documento XML llamando a los handlers. Tolerante con lo que
 * generan las planillas reales (prefijos de namespace, CDATA, comentarios),
 * estricto con lo peligroso (DTD/entidades → error).
 */
export function scanXml(xml: string, handlers: XmlHandlers): void {
    const n = xml.length;
    let i = 0;
    const wantText = handlers.text !== undefined;
    while (i < n) {
        const lt = xml.indexOf('<', i);
        if (lt === -1) {
            if (wantText && i < n) handlers.text!(xml.slice(i));
            return;
        }
        if (wantText && lt > i) handlers.text!(xml.slice(i, lt));
        const next = xml.charCodeAt(lt + 1);
        if (next === 33 /* ! */) {
            if (xml.startsWith('<!--', lt)) {
                const end = xml.indexOf('-->', lt + 4);
                i = end === -1 ? n : end + 3;
                continue;
            }
            if (xml.startsWith('<![CDATA[', lt)) {
                const end = xml.indexOf(']]>', lt + 9);
                const stop = end === -1 ? n : end;
                // Lo de un CDATA es literal: se re-escapa el `&` para que el
                // `decodeEntities` de quien lo lea lo deje como estaba.
                if (wantText) handlers.text!(xml.slice(lt + 9, stop).replace(/&/g, '&amp;'));
                i = end === -1 ? n : end + 3;
                continue;
            }
            // <!DOCTYPE / <!ENTITY: nada legítimo de una planilla los usa.
            throw new XlsxError('unsafe', 'El archivo trae definiciones XML que una planilla no usa (DOCTYPE/ENTITY).');
        }
        if (next === 63 /* ? */) {
            const end = xml.indexOf('?>', lt + 2);
            i = end === -1 ? n : end + 2;
            continue;
        }
        const gt = tagEnd(xml, lt + 1);
        if (gt === -1) return; // Documento cortado: lo leído hasta aquí vale.
        if (next === 47 /* / */) {
            handlers.close?.(localName(xml.slice(lt + 2, gt).trim()));
            i = gt + 1;
            continue;
        }
        let body = xml.slice(lt + 1, gt);
        const selfClosing = body.endsWith('/');
        if (selfClosing) body = body.slice(0, -1);
        const sp = body.search(/\s/);
        const name = localName(sp === -1 ? body : body.slice(0, sp));
        if (handlers.open) {
            const attrs: Record<string, string> = {};
            if (sp !== -1) {
                const rest = body.slice(sp);
                ATTR_RE.lastIndex = 0;
                let m: RegExpExecArray | null;
                while ((m = ATTR_RE.exec(rest)) !== null) {
                    attrs[localName(m[1]!)] = decodeEntities(m[2] ?? m[3] ?? '');
                }
            }
            handlers.open(name, attrs, selfClosing);
        }
        if (selfClosing) handlers.close?.(name);
        i = gt + 1;
    }
}

/** Fin de una etiqueta (`>`), saltando los `>` que van dentro de comillas. */
function tagEnd(xml: string, from: number): number {
    let quote = 0;
    for (let j = from; j < xml.length; j++) {
        const c = xml.charCodeAt(j);
        if (quote !== 0) {
            if (c === quote) quote = 0;
        } else if (c === 34 || c === 39) {
            quote = c;
        } else if (c === 62) {
            return j;
        }
    }
    return -1;
}

function localName(qname: string): string {
    const colon = qname.indexOf(':');
    return colon === -1 ? qname : qname.slice(colon + 1);
}

const NAMED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/**
 * Las cinco entidades de XML y las numéricas. Una entidad desconocida queda
 * tal cual: NO se expande nada definido por el archivo.
 */
export function decodeEntities(text: string): string {
    if (text.indexOf('&') === -1) return text;
    return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, ent: string) => {
        if (ent.startsWith('#x') || ent.startsWith('#X')) return codePoint(parseInt(ent.slice(2), 16)) ?? whole;
        if (ent.startsWith('#')) return codePoint(parseInt(ent.slice(1), 10)) ?? whole;
        return NAMED[ent] ?? whole;
    });
}

function codePoint(cp: number): string | null {
    if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff) return null;
    try {
        return String.fromCodePoint(cp);
    } catch {
        return null;
    }
}

/**
 * `_xHHHH_` → el carácter (escape de OOXML para saltos de línea `_x000D_`,
 * TABs y otros controles dentro de un texto de celda). `_x005F_` es un `_`.
 */
export function decodeOoxmlEscapes(text: string): string {
    if (text.indexOf('_x') === -1) return text;
    return text.replace(/_x([0-9A-Fa-f]{4})_/g, (_w, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
