/**
 * v0.1.397 — Piezas puras de la ventana «Compartir» del formulario y de la
 * agenda: el resaltado del código para insertar, la limpieza de los sitios que
 * pueden insertarlo y el texto que acompaña al enlace al mandarlo.
 */

export type CodeToken = { kind: 'tag' | 'attr' | 'str' | 'punct' | 'text'; value: string };

/**
 * Parte el HTML del código para insertar en trozos con su color: etiquetas,
 * atributos y textos entre comillas. Sólo para mostrarlo (se dibuja con React,
 * nunca como HTML). Lo que no reconoce queda como texto.
 */
export function highlightEmbedCode(code: string): CodeToken[] {
    const out: CodeToken[] = [];
    const push = (kind: CodeToken['kind'], value: string): void => {
        if (!value) return;
        const last = out[out.length - 1];
        if (last && last.kind === kind && kind === 'text') last.value += value;
        else out.push({ kind, value });
    };
    let i = 0;
    while (i < code.length) {
        const lt = code.indexOf('<', i);
        if (lt === -1) {
            push('text', code.slice(i));
            break;
        }
        push('text', code.slice(i, lt));
        const gt = findTagEnd(code, lt);
        const inner = code.slice(lt, gt === -1 ? code.length : gt + 1);
        tokenizeTag(inner, push);
        if (gt === -1) break;
        i = gt + 1;
    }
    return out;
}

/** El `>` que cierra la etiqueta, salteando los que van entre comillas. */
function findTagEnd(code: string, from: number): number {
    let quote: string | null = null;
    for (let j = from + 1; j < code.length; j++) {
        const c = code[j];
        if (quote) {
            if (c === quote) quote = null;
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') return j;
    }
    return -1;
}

function tokenizeTag(tag: string, push: (kind: CodeToken['kind'], value: string) => void): void {
    const name = /^<\/?[A-Za-z][\w-]*/.exec(tag);
    if (!name) {
        push('text', tag);
        return;
    }
    push('tag', name[0]);
    let rest = tag.slice(name[0].length);
    const re = /(\s+)|([^\s=>"'/]+)|(=)|("[^"]*"?|'[^']*'?)|(\/?>)/y;
    while (rest.length) {
        re.lastIndex = 0;
        const m = re.exec(rest);
        if (!m) {
            push('text', rest);
            return;
        }
        if (m[1]) push('text', m[1]);
        else if (m[2]) push('attr', m[2]);
        else if (m[3]) push('punct', m[3]);
        else if (m[4]) push('str', m[4]);
        else if (m[5]) push('tag', m[5]);
        rest = rest.slice(m[0].length);
    }
}

/**
 * Lo que escribió la persona en «Sitios que pueden insertarlo», limpio: sin
 * la ruta ni la barra final (`https://tusitio.com/contacto/` → `https://tusitio.com`,
 * `tusitio.com/contacto` → `tusitio.com`). `null` si no parece un sitio.
 */
export function cleanEmbedDomain(raw: string): string | null {
    const text = raw.trim().replace(/[,;]+$/, '');
    if (!text || /\s/.test(text)) return null;
    if (text.includes('://')) {
        try {
            const u = new URL(text);
            if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
            return u.origin;
        } catch {
            return null;
        }
    }
    const host = text.split(/[/?#]/)[0]!.toLowerCase();
    if (/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{1,5})?$/.test(host) || /^localhost(:\d{1,5})?$/.test(host)) return host;
    return null;
}

/** El texto que acompaña al enlace al mandarlo por WhatsApp, correo u otra app. */
export function shareMessage(kind: 'form' | 'booking' | 'shop', name: string, url: string): string {
    const title = name.trim();
    if (kind === 'booking') return title ? `${title}: agenda tu cita aquí ${url}` : `Agenda tu cita aquí: ${url}`;
    if (kind === 'shop') return title ? `${title}: mira nuestros productos y compra aquí ${url}` : `Mira nuestros productos y compra aquí: ${url}`;
    return title ? `${title}: ${url}` : url;
}
