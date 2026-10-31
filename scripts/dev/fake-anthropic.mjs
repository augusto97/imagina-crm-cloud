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
 *   - `submit_suggestions` (v0.1.341, sugerencias por lista): en la primera
 *     vuelta lee el perfil de la lista y arma propuestas con las herramientas
 *     `propose_*` (una vista de los montos más altos y, si hay un estado con
 *     una opción «vencida» y una fecha, una automatización que la marca); en la
 *     segunda entrega las que validaron con `submit_suggestions`.
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


function profileFrom(text) {
    const m = /```json\n([\s\S]*?)\n```/.exec(text);
    return m ? JSON.parse(m[1]) : null;
}

/** Primera vuelta de las sugerencias: propuestas armadas con el perfil. */
function suggestionCalls(profile) {
    const calls = [];
    const fields = profile?.campos ?? [];
    const slug = profile?.lista?.slug;
    const money = fields.find((f) => f.tipo === 'currency') ?? fields.find((f) => f.tipo === 'number');
    if (money) {
        calls.push({
            name: 'propose_create_view',
            input: { list: slug, view: { name: `Mayor ${String(money.nombre).toLowerCase()} primero`, type: 'table', sort: [{ field: money.slug, dir: 'desc' }] } },
        });
    }
    const status = fields.find((f) => f.slug === profile?.campo_de_estado);
    const overdue = status?.opciones?.find((o) => /venc/i.test(o.etiqueta));
    const due = fields.find((f) => (f.tipo === 'date' || f.tipo === 'datetime') && /venc|pago|entrega|limite/i.test(f.nombre));
    if (status && overdue && due) {
        const open = (status.opciones ?? []).filter((o) => !/pagad|cerrad|ganad|termin|venc/i.test(o.etiqueta)).map((o) => o.value);
        calls.push({
            name: 'propose_create_automation',
            input: {
                list: slug,
                name: `Marcar como ${overdue.etiqueta.toLowerCase()} al pasar ${String(due.nombre).toLowerCase()}`,
                trigger_type: 'due_date_reached',
                trigger_config: { due_field: due.slug, offset_minutes: 1440, field_filters: open.length ? [{ field: status.slug, op: 'in', value: open }] : [] },
                actions: [{ type: 'update_field', config: { values: { [status.slug]: overdue.value } } }],
            },
        });
    }
    if (calls.length === 0) {
        // Sin monto ni vencimiento: una vista ordenada por el primer campo de texto.
        const text = fields.find((f) => f.tipo === 'text');
        if (text) calls.push({ name: 'propose_create_view', input: { list: slug, view: { name: `Por ${String(text.nombre).toLowerCase()}`, type: 'table', sort: [{ field: text.slug, dir: 'asc' }] } } });
    }
    return calls;
}

/** Segunda vuelta: entrega lo que validó. */
function suggestionSubmit(p) {
    const last = p.messages[p.messages.length - 1];
    const results = Array.isArray(last?.content) ? last.content.filter((b) => b.type === 'tool_result' && !b.is_error) : [];
    const ids = [];
    for (const r of results) {
        try {
            const c = JSON.parse(typeof r.content === 'string' ? r.content : r.content.map((x) => x.text ?? '').join(''));
            if (c.proposal_id) ids.push({ id: c.proposal_id, title: c.title ?? c.message ?? '' });
        } catch {
            // no es JSON
        }
    }
    const firstUser = p.messages.find((m) => m.role === 'user');
    const profile = profileFrom(typeof firstUser.content === 'string' ? firstUser.content : '');
    const vencidas = (profile?.campos ?? []).map((f) => f.fechas?.vencidas_sin_cerrar ?? 0).reduce((a, b) => Math.max(a, b), 0);
    return {
        suggestions: ids.map((x, i) =>
            i === 0
                ? { proposal_id: x.id, title: 'Revisa primero lo de mayor valor', why: `Tienes ${profile?.registros ?? 0} registros: ordenarlos por el monto pone arriba los que más pesan en tu caja.` }
                : { proposal_id: x.id, title: 'Marca solo lo vencido', why: `${vencidas} registros ya pasaron su fecha y siguen abiertos: que el estado cambie solo al día siguiente evita revisarlos a mano.` },
        ),
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
            const sugg = (p.tools ?? []).find((t) => t.name === 'submit_suggestions');
            if (sugg) {
                const last = p.messages[p.messages.length - 1];
                const firstTurn = typeof last.content === 'string';
                const blocks = firstTurn
                    ? suggestionCalls(profileFrom(last.content)).map((c, i) => ({ id: `toolu_s${i}`, name: c.name, input: c.input }))
                    : [{ id: 'toolu_submit', name: 'submit_suggestions', input: suggestionSubmit(p) }];
                blocks.forEach((b, i) => {
                    events.push(['content_block_start', { type: 'content_block_start', index: i, content_block: { type: 'tool_use', id: b.id, name: b.name, input: {} } }]);
                    events.push(['content_block_delta', { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } }]);
                    events.push(['content_block_stop', { type: 'content_block_stop', index: i }]);
                });
                events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 300 } }]);
            } else if (tool) {
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
