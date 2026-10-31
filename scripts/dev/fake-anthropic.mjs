/**
 * Anthropic SIMULADO para probar la IA en el navegador sin salir a la red
 * (v0.1.339). Responde `GET /v1/models` y `POST /v1/messages` en streaming
 * (SSE), con una respuesta armada según la herramienta que pide el pedido:
 *
 *   - `submit_import_plan` («Crear desde un archivo»): lee el resumen del
 *     archivo que viaja en el mensaje y devuelve ajustes razonables (nombres
 *     más claros, opciones juntadas con color, descarta lo sugerido, acepta las
 *     listas separadas). Guarda el último pedido en /tmp/fake-anthropic-last.json
 *     para revisar qué se mandó.
 *   - cualquier otra: un texto corto.
 *
 * Uso:  node scripts/dev/fake-anthropic.mjs [puerto=4899]
 *       y arrancar el API con ANTHROPIC_BASE_URL=http://127.0.0.1:4899
 */
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';

const PORT = Number(process.argv[2] ?? 4899);
const CAPS = { thinking: { supported: true, types: { adaptive: { supported: true } } }, effort: { supported: true, low: { supported: true }, medium: { supported: true }, high: { supported: true } } };
const MODELS = [
    { type: 'model', id: 'claude-opus-9-5', display_name: 'Claude Opus 9.5', created_at: '2030-06-01T00:00:00Z', capabilities: CAPS },
    { type: 'model', id: 'claude-haiku-9-0', display_name: 'Claude Haiku 9', created_at: '2030-01-01T00:00:00Z', capabilities: CAPS },
];

function importPlan(text) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    const summary = JSON.parse(text.slice(start, end + 1));
    const columns = [];
    const lists = [];
    for (const h of summary.hojas) {
        const draft = summary.borrador.listas.find((l) => l.sheet === h.sheet);
        lists.push({ sheet: h.sheet, name: draft ? `${draft.nombre}`.replace(/\b2026\b/, '').trim() || draft.nombre : h.nombre });
        for (const c of h.columnas) {
            const out = { sheet: h.sheet, column: c.column };
            if (/^[A-ZÁÉÍÓÚÑ _]+$/.test(c.encabezado) && c.encabezado.length > 3) out.label = c.encabezado.charAt(0) + c.encabezado.slice(1).toLowerCase();
            if (/^tel$|^tel\.|^cel$/i.test(c.encabezado)) out.label = 'Teléfono';
            if (c.sugerencia_descartar) {
                out.include = false;
                out.reason = 'No aporta en la app: ' + c.sugerencia_descartar.toLowerCase();
            }
            if (c.tipo_por_reglas === 'select' && Array.isArray(c.top)) {
                const groups = new Map();
                for (const t of c.top) {
                    const k = String(t.value).trim().toLowerCase().replace(/o$/, 'a');
                    const g = groups.get(k) ?? [];
                    g.push(t.value);
                    groups.set(k, g);
                }
                const color = (l) => (/pagad|activ|ganad|entregad/.test(l) ? 'green' : /vencid|perdid|cancel/.test(l) ? 'red' : /pendient|proceso/.test(l) ? 'amber' : undefined);
                out.options = [...groups.entries()].map(([k, from]) => ({ label: k.charAt(0).toUpperCase() + k.slice(1), color: color(k), from }));
            }
            if (Object.keys(out).length > 2) columns.push(out);
        }
    }
    return {
        kind: summary.borrador.tipo_de_datos === 'generic' ? 'contacts' : summary.borrador.tipo_de_datos,
        summary: 'Revisé las columnas: junté opciones escritas distinto, dejé nombres más claros y quité lo que no hace falta.',
        lists,
        columns,
        entities: summary.borrador.listas_separadas.map((e) => ({ sheet: e.sheet, key_column: e.key_column, include: true })),
        links: summary.borrador.vinculos.map((l) => ({ sheet: l.sheet, column: l.column, include: true })),
    };
}

function sse(res, events) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.end();
}

createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        const url = req.url.split('?')[0];
        if (req.method === 'GET' && url === '/v1/models') {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ data: MODELS, has_more: false, first_id: MODELS[0].id, last_id: MODELS.at(-1).id }));
            return;
        }
        if (req.method === 'POST' && url === '/v1/messages') {
            const p = JSON.parse(body || '{}');
            writeFileSync('/tmp/fake-anthropic-last.json', JSON.stringify(p, null, 2));
            const tool = (p.tools ?? []).find((t) => t.name === 'submit_import_plan');
            const msg = { id: 'msg_fake', type: 'message', role: 'assistant', model: p.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 900, output_tokens: 1 } };
            const events = [['message_start', { type: 'message_start', message: msg }]];
            if (tool) {
                const user = p.messages.find((m) => m.role === 'user');
                const text = typeof user.content === 'string' ? user.content : user.content.map((b) => b.text ?? '').join('');
                const input = JSON.stringify(importPlan(text));
                events.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_fake', name: tool.name, input: {} } }]);
                events.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: input } }]);
                events.push(['content_block_stop', { type: 'content_block_stop', index: 0 }]);
                events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 300 } }]);
            } else {
                events.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }]);
                events.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hola (respuesta simulada).' } }]);
                events.push(['content_block_stop', { type: 'content_block_stop', index: 0 }]);
                events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 6 } }]);
            }
            events.push(['message_stop', { type: 'message_stop' }]);
            setTimeout(() => sse(res, events), 800);
            return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'no' } }));
    });
}).listen(PORT, '127.0.0.1', () => console.log(`Anthropic simulado en http://127.0.0.1:${PORT}`));
