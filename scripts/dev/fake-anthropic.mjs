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
 *   - `list_lists` (v0.1.370, el chat del asistente): la primera vuelta pide
 *     `list_lists`; la segunda responde en Markdown (título, negrita, tabla con
 *     enlaces a las listas, lista de tareas, código) en varios pedazos. Si el
 *     pedido dice «falla», las tres primeras llamadas responden 529 (el SDK
 *     reintenta dos veces solo; la tercera falla llega a la persona y la
 *     cuarta —su «Reintentar»— sale bien); si dice «lento», los pedazos llegan de a uno cada 700 ms
 *     (para probar «Detener» y el texto en vivo).
 *   - v0.1.456 (IA en el día a día), según el sistema del pedido:
 *       · resumen del registro → el JSON {headline, points, pending, next} con
 *         el título del registro que viaja en los datos;
 *       · escribir con IA → un texto en el formato sencillo (redactar) o el
 *         seleccionado transformado (traducir → «[EN] …», mejorar → «Mejorado: …»);
 *       · sugerir respuesta → un borrador corto (otro si es para el cliente);
 *       · un agente de IA → primero `update_fields` (la prioridad en «alta»,
 *         si la lista tiene ese campo) o `comment`, y después el resumen. Si la
 *         instrucción dice «falla», responde 400 (el agente falla con motivo).
 *   - v0.1.463 (`submit_automation`, «Describir con IA» del editor de
 *     automatizaciones): lee el esquema de la lista que viaja en el mensaje y
 *     arma una automatización con sus campos reales (cuando cambia el estado
 *     → según su valor, un correo al correo del registro → espera 2 días).
 *     Con <automatizacion_actual> («Pedir un cambio») la devuelve igual con
 *     un paso más al final (esperar 1 día). Si el pedido dice «corrige», la
 *     primera vuelta usa un campo inventado (para probar el reintento).
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

/** v0.1.463 — «Describir con IA»: una automatización armada con los campos reales de la lista. */
function automationDraft(p) {
    const first = p.messages.find((m) => m.role === 'user');
    const text = typeof first.content === 'string' ? first.content : first.content.map((b) => b.text ?? '').join('\n');
    const schemaRaw = /<esquema_de_la_lista>\n([\s\S]*?)\n<\/esquema_de_la_lista>/.exec(text)?.[1];
    const currentRaw = /<automatizacion_actual>\n([\s\S]*?)\n<\/automatizacion_actual>/.exec(text)?.[1];
    const asked = /<pedido>\n([\s\S]*?)\n<\/pedido>/.exec(text)?.[1] ?? '';
    const schema = schemaRaw ? JSON.parse(schemaRaw) : { fields: [] };
    const retrying = p.messages.some((m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result'));
    if (currentRaw) {
        const cur = JSON.parse(currentRaw);
        return {
            name: cur.name,
            description: cur.description ?? undefined,
            trigger_type: cur.trigger_type,
            trigger_config: cur.trigger_config,
            actions: [...cur.actions, { type: 'wait', config: { mode: 'duration', amount: 1, unit: 'days' } }],
            is_active: cur.is_active,
        };
    }
    const fields = schema.fields ?? [];
    const select = fields.find((f) => f.type === 'select');
    const email = fields.find((f) => f.type === 'email');
    const phone = fields.find((f) => f.type === 'phone');
    const title = fields.find((f) => f.is_title) ?? fields.find((f) => f.type === 'text');
    const option = select?.options?.find((o) => /venc|pend/i.test(`${o.value} ${o.label}`)) ?? select?.options?.[0];
    const warnings = [];
    if (/whatsapp/i.test(asked) && !phone) warnings.push('No encontré un campo de teléfono: completa el destinatario del WhatsApp.');
    if (!email) warnings.push('No encontré un campo de correo: completa el destinatario del correo.');
    const mail = { type: 'send_email', config: { to: email ? `{{${email.slug}}}` : '', subject: `Aviso: {{${title?.slug ?? 'record.id'}}}`, body: 'Hola, tu registro cambió de estado. Revísalo cuando puedas.' } };
    const watched = /corrige/i.test(asked) && !retrying ? 'campo_inventado' : select?.slug;
    return {
        name: select ? `Avisar cuando «${select.label}» cambie` : 'Avisar al crear un registro',
        trigger_type: select ? 'record_updated' : 'record_created',
        trigger_config: select ? { changed_fields: [watched] } : {},
        actions: [
            select && option ? { type: 'switch', config: { field: select.slug, cases: [{ label: option.label, value: option.value, actions: [mail] }] } } : mail,
            { type: 'wait', config: { mode: 'duration', amount: 2, unit: 'days' } },
        ],
        warnings,
    };
}

function sse(res, events, gapMs = 0) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    if (!gapMs) {
        for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        res.end();
        return;
    }
    let i = 0;
    const tick = () => {
        if (res.destroyed) return;
        if (i >= events.length) return void res.end();
        const [event, data] = events[i++];
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        setTimeout(tick, event === 'content_block_delta' ? gapMs : 0);
    };
    tick();
}

/** v0.1.370 — Lo que pidió la persona (el último texto de usuario). */
function lastUserText(p) {
    for (let i = p.messages.length - 1; i >= 0; i--) {
        const m = p.messages[i];
        if (m.role !== 'user') continue;
        if (typeof m.content === 'string') return m.content;
        const t = m.content.find((b) => b.type === 'text');
        if (t) return t.text;
    }
    return '';
}

const failures = new Map();

/** v0.1.456 — el sistema del pedido (texto plano o bloques). */
function systemText(p) {
    if (typeof p.system === 'string') return p.system;
    return (p.system ?? []).map((b) => b.text ?? '').join('\n');
}

/** v0.1.456 — Respuestas de la IA en el día a día (resumen, escribir, responder). */
function dailyAnswer(sys, user) {
    if (/«¿qué pasó con esto\?»/.test(sys)) {
        const title = /"titulo":\s*"([^"]*)"/.exec(user)?.[1] ?? 'el registro';
        const comments = (user.match(/"texto":/g) ?? []).length;
        return JSON.stringify({
            headline: `«${title}» está en seguimiento: hay ${comments} comentario(s) y cosas por cerrar.`,
            points: ['Se actualizó hace poco.', comments > 0 ? 'El último comentario pide revisar la propuesta.' : 'Todavía no hay conversación.'],
            pending: ['Confirmar el siguiente paso con el cliente.'],
            next: ['Revisar el registro esta semana.'],
        });
    }
    if (/Redactas texto para la descripción/.test(sys)) {
        return '## Próximos pasos\n\n- Llamar al cliente el lunes\n- Enviar la **propuesta** actualizada';
    }
    if (/<texto>/.test(user)) {
        const text = /<texto>\n?([\s\S]*?)\n?<\/texto>/.exec(user)?.[1]?.trim() ?? '';
        if (/inglés/i.test(sys)) return `[EN] ${text}`;
        if (/portugués/i.test(sys)) return `[PT] ${text}`;
        return `Mejorado: ${text}`;
    }
    if (/respuesta a un hilo de comentarios/.test(sys)) {
        return /CLIENTE/.test(sys) ? 'Hola, gracias por escribirnos. Ya revisamos tu caso y te contamos mañana.' : 'Lo reviso hoy y les aviso.';
    }
    return null;
}

/** v0.1.456 — un agente de IA (el que se pide desde la ficha o en lote). */
function agentTurn(p, user) {
    const last = p.messages[p.messages.length - 1];
    const firstTurn = typeof last.content === 'string' || !last.content.some((b) => b.type === 'tool_result');
    const tools = (p.tools ?? []).map((t) => t.name);
    if (!firstTurn) return { text: 'Listo: revisé el registro y dejé la prioridad al día.' };
    const prio = /"slug":"prioridad"/.test(user);
    if (prio && tools.includes('update_fields')) return { tool: 'update_fields', input: { values: { prioridad: 'alta' } } };
    if (tools.includes('comment')) return { tool: 'comment', input: { body: 'Revisé el registro: todo en orden.' } };
    return { text: 'No tengo herramientas para cambiar este registro.' };
}

function chatAnswer(p) {
    const last = p.messages[p.messages.length - 1];
    let lists = [];
    for (const b of Array.isArray(last.content) ? last.content : []) {
        if (b.type !== 'tool_result') continue;
        try {
            const c = JSON.parse(typeof b.content === 'string' ? b.content : b.content.map((x) => x.text ?? '').join(''));
            lists = c.lists ?? [];
        } catch {
            /* sin datos */
        }
    }
    const top = lists.slice(0, 3);
    const rows = top.map((l) => `| [${l.name}](/lists/${l.slug}/records) | ${l.fields_count} |`).join('\n');
    return [
        '## Tus listas\n\n',
        `Tienes **${lists.length} listas** en esta empresa. Estas son las primeras:\n\n`,
        '| Lista | Campos |\n|:---|---:|\n',
        `${rows}\n\n`,
        '- [x] Revisé qué listas tienes\n- [ ] Falta armar un tablero con los números\n\n',
        'Un filtro de ejemplo:\n\n```json\n{ "estado": "pendiente" }\n```\n\n',
        top[0] ? `Abre [${top[0].name}](/lists/${top[0].slug}/records) o lee más en https://imagina.cloud/base.` : 'Todavía no tienes listas.',
    ];
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
            const draftTool = (p.tools ?? []).find((t) => t.name === 'submit_automation');
            const chat = !sugg && !tool && !draftTool && (p.tools ?? []).some((t) => t.name === 'list_lists');
            const asked = lastUserText(p);
            const sys = systemText(p);
            const firstUser = (() => {
                const u = p.messages.find((m) => m.role === 'user');
                if (!u) return '';
                return typeof u.content === 'string' ? u.content : u.content.map((b) => b.text ?? '').join('');
            })();
            const isAgent = !chat && /un agente de IA que trabaja dentro de/.test(sys);
            const daily = !chat && !sugg && !tool && !isAgent && !draftTool ? dailyAnswer(sys, firstUser) : null;
            if (isAgent && /falla/i.test(firstUser)) {
                res.writeHead(400, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Simulación: el modelo rechazó el pedido.' } }));
                return;
            }
            let gap = 0;
            if (chat && /falla/i.test(asked) && (failures.get(asked) ?? 0) < 3) {
                failures.set(asked, (failures.get(asked) ?? 0) + 1);
                res.writeHead(529, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }));
                return;
            }
            if (chat && !draftTool) {
                const last = p.messages[p.messages.length - 1];
                const firstTurn = typeof last.content === 'string' || !last.content.some((b) => b.type === 'tool_result');
                if (/lento/i.test(asked)) gap = 700;
                // «propón un campo de prioridad para <slug>»: una propuesta de verdad.
                const propose = /prop[oó]n.*prioridad/i.test(asked) ? /para (\S+)/.exec(asked)?.[1] : null;
                if (firstTurn && propose) {
                    const input = { list: propose, fields: [{ label: 'Prioridad', type: 'select', options: [{ label: 'Alta', color: 'red' }, { label: 'Media', color: 'amber' }, { label: 'Baja', color: 'green' }] }] };
                    events.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }]);
                    events.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Te propongo un campo **Prioridad** con tres opciones.' } }]);
                    events.push(['content_block_stop', { type: 'content_block_stop', index: 0 }]);
                    events.push(['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_prop', name: 'propose_add_fields', input: {} } }]);
                    events.push(['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } }]);
                    events.push(['content_block_stop', { type: 'content_block_stop', index: 1 }]);
                    events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 80 } }]);
                } else if (!firstTurn && propose) {
                    events.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }]);
                    events.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Revisa la tarjeta y, si te sirve, **aplícala**:\n\n- Alta en rojo\n- Media en ámbar\n- Baja en verde' } }]);
                    events.push(['content_block_stop', { type: 'content_block_stop', index: 0 }]);
                    events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 40 } }]);
                } else if (firstTurn) {
                    events.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_chat', name: 'list_lists', input: {} } }]);
                    events.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }]);
                    events.push(['content_block_stop', { type: 'content_block_stop', index: 0 }]);
                    events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 40 } }]);
                } else {
                    events.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }]);
                    for (const piece of chatAnswer(p)) events.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } }]);
                    events.push(['content_block_stop', { type: 'content_block_stop', index: 0 }]);
                    events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 220 } }]);
                }
            } else if (draftTool) {
                const input = JSON.stringify(automationDraft(p));
                events.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_draft_${Date.now()}`, name: 'submit_automation', input: {} } }]);
                events.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: input } }]);
                events.push(['content_block_stop', { type: 'content_block_stop', index: 0 }]);
                events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 400 } }]);
            } else if (sugg) {
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
            } else if (isAgent) {
                const turn = agentTurn(p, firstUser);
                if (turn.tool) {
                    events.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_agent_${Date.now()}`, name: turn.tool, input: {} } }]);
                    events.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(turn.input) } }]);
                    events.push(['content_block_stop', { type: 'content_block_stop', index: 0 }]);
                    events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 60 } }]);
                } else {
                    events.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }]);
                    events.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: turn.text } }]);
                    events.push(['content_block_stop', { type: 'content_block_stop', index: 0 }]);
                    events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 30 } }]);
                }
            } else if (daily !== null) {
                events.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }]);
                events.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: daily } }]);
                events.push(['content_block_stop', { type: 'content_block_stop', index: 0 }]);
                events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 120 } }]);
            } else {
                events.push(['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }]);
                events.push(['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hola (respuesta simulada).' } }]);
                events.push(['content_block_stop', { type: 'content_block_stop', index: 0 }]);
                events.push(['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 6 } }]);
            }
            events.push(['message_stop', { type: 'message_stop' }]);
            setTimeout(() => sse(res, events, gap), gap ? 200 : 800);
            return;
        }
        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'no' } }));
    });
}).listen(PORT, '127.0.0.1', () => console.log(`Anthropic simulado en http://127.0.0.1:${PORT}`));
