/**
 * Parser mínimo de Server-Sent Events para `fetch` + `ReadableStream`
 * (v0.1.181, chat del asistente). El navegador no expone `EventSource` con
 * POST ni con headers, así que se lee el body a mano: los chunks llegan
 * cortados en cualquier punto, por eso hay buffer y se emite sólo cuando
 * aparece el separador de evento (línea en blanco).
 *
 * Sólo se interpretan las líneas `data:` (multilínea → se unen con `\n`);
 * `event:`/`id:`/`retry:` y los comentarios `:` se ignoran.
 */
export interface SseParser {
    /** Alimenta un chunk; devuelve los `data` de los eventos COMPLETOS que contenía. */
    push(chunk: string): string[];
    /** Vacía lo que quedó sin separador final (si el servidor cerró sin `\n\n`). */
    flush(): string[];
}

export function createSseParser(): SseParser {
    let buffer = '';
    const parseBlock = (block: string): string | null => {
        const data: string[] = [];
        for (const rawLine of block.split('\n')) {
            const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
            if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
        return data.length > 0 ? data.join('\n') : null;
    };
    return {
        push(chunk) {
            buffer += chunk.replace(/\r\n/g, '\n');
            const out: string[] = [];
            let idx = buffer.indexOf('\n\n');
            while (idx !== -1) {
                const block = buffer.slice(0, idx);
                buffer = buffer.slice(idx + 2);
                const d = parseBlock(block);
                if (d !== null) out.push(d);
                idx = buffer.indexOf('\n\n');
            }
            return out;
        },
        flush() {
            const rest = buffer;
            buffer = '';
            if (!rest.trim()) return [];
            const d = parseBlock(rest);
            return d !== null ? [d] : [];
        },
    };
}
