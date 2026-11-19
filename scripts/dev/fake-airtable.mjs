// Airtable FALSO para el E2E y las pruebas (v0.1.458 — importar una base de Airtable).
//
//   node scripts/dev/fake-airtable.mjs [puerto=4896]
//
// Imita lo que la app usa de la API web de Airtable (v0): `meta/whoami`,
// `meta/bases`, `meta/bases/{base}/tables` y la lectura de registros de a 100
// con `offset`, `fields[]` y `returnFieldsByFieldId`. Los adjuntos se sirven en
// `/att/<id>/<nombre>` (como las URLs de `airtableusercontent.com`).
//
// Tokens que acepta:
//   patDemoAgencia0001.0123456789abcdef0123456789abcdef   todos los permisos
//   patSoloDatos000001.0123456789abcdef0123456789abcdef   sin «schema.bases:read»
//   cualquier otro → 401
//
// Env:
//   FAKE_AIRTABLE_MEMBER_EMAIL   correo del colaborador que es miembro de la empresa (default e2e@test.local)
//   FAKE_AIRTABLE_RATE_LIMIT     cuántos pedidos de registros responden 429 antes de contestar (default 0)
//
// Para las pruebas:
//   GET  /__stats                    → pedidos, 429 devueltos, adjuntos servidos
//   POST /__control {rate_limit, retry_after}
//        los próximos `rate_limit` pedidos de registros responden 429 (con
//        `Retry-After: retry_after` si se pasa; Airtable de verdad no lo manda).
//
// También se usa desde los tests de la API (`apps/api/test/helpers/fake-airtable.ts`).
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

export const FULL_TOKEN = 'patDemoAgencia0001.0123456789abcdef0123456789abcdef';
export const DATA_ONLY_TOKEN = 'patSoloDatos000001.0123456789abcdef0123456789abcdef';
export const AGENCY_BASE = 'appAgenciaDemo0001';
export const STOCK_BASE = 'appInventario00001';

// ── Bytes de los adjuntos (PNG y PDF de verdad, chicos) ────────────────────

function crc32(buf) {
    let c = ~0;
    for (const b of buf) {
        c ^= b;
        for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
}
function pngChunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
}
/** Un PNG de `w`×`h` de un color (con algo de ruido para que pese distinto). */
function png(w, h, seed) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0);
    ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8;
    ihdr[9] = 2;
    const raw = Buffer.alloc((w * 3 + 1) * h);
    let s = seed;
    for (let y = 0; y < h; y++) {
        raw[y * (w * 3 + 1)] = 0;
        for (let x = 0; x < w; x++) {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            const o = y * (w * 3 + 1) + 1 + x * 3;
            raw[o] = (40 + (seed * 37) % 160 + (s % 16)) & 255;
            raw[o + 1] = (90 + (seed * 53) % 120) & 255;
            raw[o + 2] = (150 + (s % 32)) & 255;
        }
    }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', deflateSync(raw)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}
function pdf(title) {
    const body = `%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >> endobj\n% ${title}\ntrailer << /Root 1 0 R >>\n%%EOF\n`;
    return Buffer.from(body, 'utf8');
}

// ── La base de ejemplo ──────────────────────────────────────────────────────

const f = (id, name, type, options) => ({ id, name, type, ...(options ? { options } : {}) });
const choice = (id, name, color) => ({ id, name, color });

function agencySchema() {
    return [
        {
            id: 'tblClientes000001',
            name: 'Clientes',
            primaryFieldId: 'fldCliNombre00001',
            description: 'Las empresas con las que trabajamos',
            fields: [
                f('fldCliNombre00001', 'Nombre', 'singleLineText'),
                f('fldCliCorreo00001', 'Correo', 'email'),
                f('fldCliTelefono001', 'Teléfono', 'phoneNumber'),
                f('fldCliWeb00000001', 'Sitio web', 'url'),
                f('fldCliSegmento001', 'Segmento', 'singleSelect', {
                    choices: [choice('selPyme000000001', 'Pyme', 'blueLight2'), choice('selCorp000000001', 'Corporativo', 'purpleBright'), choice('selGob0000000001', 'Gobierno', 'greenLight1')],
                }),
                f('fldCliEtiquetas01', 'Etiquetas', 'multipleSelects', {
                    choices: [choice('selVip0000000001', 'VIP', 'redLight2'), choice('selRec0000000001', 'Recurrente', 'tealLight2'), choice('selRef0000000001', 'Referido', 'yellowLight2')],
                }),
                f('fldCliNotas000001', 'Notas', 'multilineText'),
                f('fldCliActivo00001', 'Activo', 'checkbox', { icon: 'check', color: 'greenBright' }),
                f('fldCliProyectos01', 'Proyectos', 'multipleRecordLinks', {
                    linkedTableId: 'tblProyectos00001',
                    inverseLinkFieldId: 'fldProCliente0001',
                    isReversed: false,
                    prefersSingleRecordLink: false,
                }),
                f('fldCliEjecutivo01', 'Ejecutivo', 'singleCollaborator'),
                f('fldCliAlta0000001', 'Fecha de alta', 'createdTime', { result: { type: 'dateTime', options: { timeZone: 'client' } } }),
            ],
            views: [{ id: 'viwClientes00001', name: 'Todos', type: 'grid' }],
        },
        {
            id: 'tblProyectos00001',
            name: 'Proyectos',
            primaryFieldId: 'fldProNombre00001',
            fields: [
                f('fldProNombre00001', 'Nombre', 'singleLineText'),
                f('fldProCliente0001', 'Cliente', 'multipleRecordLinks', {
                    linkedTableId: 'tblClientes000001',
                    inverseLinkFieldId: 'fldCliProyectos01',
                    isReversed: false,
                    prefersSingleRecordLink: true,
                }),
                f('fldProCodigo00001', 'Código', 'autoNumber'),
                f('fldProPresupuest1', 'Presupuesto', 'currency', { precision: 0, symbol: '$' }),
                f('fldProAvance00001', 'Avance', 'percent', { precision: 0 }),
                f('fldProInicio00001', 'Inicio', 'date', { dateFormat: { name: 'local', format: 'l' } }),
                f('fldProEntrega0001', 'Entrega', 'dateTime', {
                    dateFormat: { name: 'local', format: 'l' },
                    timeFormat: { name: '24hour', format: 'HH:mm' },
                    timeZone: 'America/Bogota',
                }),
                f('fldProEstado00001', 'Estado', 'singleSelect', {
                    choices: [
                        choice('selProp000000001', 'Propuesta', 'grayLight2'),
                        choice('selCurso00000001', 'En curso', 'blueLight2'),
                        choice('selPausa00000001', 'Pausado', 'orangeLight2'),
                        choice('selFin0000000001', 'Terminado', 'greenBright'),
                    ],
                }),
                f('fldProSatisfacc01', 'Satisfacción', 'rating', { max: 5, icon: 'star', color: 'yellowBright' }),
                f('fldProDuracion001', 'Tiempo estimado', 'duration', { durationFormat: 'h:mm' }),
                f('fldProDescripc001', 'Descripción', 'richText'),
                f('fldProLider000001', 'Líder', 'singleCollaborator'),
                f('fldProTareas00001', 'Tareas', 'multipleRecordLinks', {
                    linkedTableId: 'tblTareas00000001',
                    inverseLinkFieldId: 'fldTarProyecto001',
                    isReversed: false,
                    prefersSingleRecordLink: false,
                }),
                f('fldProHoras000001', 'Horas registradas', 'rollup', {
                    recordLinkFieldId: 'fldProTareas00001',
                    fieldIdInLinkedTable: 'fldTarHoras000001',
                    isValid: true,
                    result: { type: 'number', options: { precision: 1 } },
                }),
                f('fldProNTareas0001', 'N.º de tareas', 'count', { recordLinkFieldId: 'fldProTareas00001', isValid: true }),
                f('fldProMargen00001', 'Margen estimado', 'formula', {
                    formula: '{Presupuesto} * 0.3',
                    isValid: true,
                    referencedFieldIds: ['fldProPresupuest1'],
                    result: { type: 'currency', options: { precision: 0, symbol: '$' } },
                }),
                f('fldProResumen0001', 'Resumen', 'formula', {
                    formula: "{Nombre} & ' · ' & {Estado}",
                    isValid: true,
                    referencedFieldIds: ['fldProNombre00001', 'fldProEstado00001'],
                    result: { type: 'singleLineText' },
                }),
                f('fldProCorreoCli01', 'Correo del cliente', 'multipleLookupValues', {
                    recordLinkFieldId: 'fldProCliente0001',
                    fieldIdInLinkedTable: 'fldCliCorreo00001',
                    isValid: true,
                    result: { type: 'email' },
                }),
                f('fldProBoton000001', 'Abrir en Drive', 'button'),
            ],
            views: [{ id: 'viwProyectos0001', name: 'Todos', type: 'grid' }],
        },
        {
            id: 'tblTareas00000001',
            name: 'Tareas',
            primaryFieldId: 'fldTarTitulo00001',
            fields: [
                f('fldTarTitulo00001', 'Tarea', 'singleLineText'),
                f('fldTarProyecto001', 'Proyecto', 'multipleRecordLinks', {
                    linkedTableId: 'tblProyectos00001',
                    inverseLinkFieldId: 'fldProTareas00001',
                    isReversed: false,
                    prefersSingleRecordLink: true,
                }),
                f('fldTarArchivos001', 'Archivos', 'multipleAttachments', { isReversed: false }),
                f('fldTarHoras000001', 'Horas', 'number', { precision: 1 }),
                f('fldTarHecha000001', 'Hecha', 'checkbox', { icon: 'check', color: 'greenBright' }),
                f('fldTarPrioridad01', 'Prioridad', 'singleSelect', {
                    choices: [choice('selAlta000000001', 'Alta', 'redBright'), choice('selMedia00000001', 'Media', 'yellowLight1'), choice('selBaja00000001', 'Baja', 'grayLight1')],
                }),
                f('fldTarAsignados01', 'Asignados', 'multipleCollaborators'),
                f('fldTarVence000001', 'Vence', 'date', { dateFormat: { name: 'iso', format: 'YYYY-MM-DD' } }),
                f('fldTarCreadaPor01', 'Creada por', 'createdBy'),
                f('fldTarEditada0001', 'Última edición', 'lastModifiedTime', { result: { type: 'dateTime', options: { timeZone: 'utc' } } }),
                f('fldTarBarras00001', 'Código de barras', 'barcode'),
                f('fldTarResumenIa01', 'Resumen IA', 'aiText'),
                f('fldTarNuevo000001', 'Campo nuevo de Airtable', 'someFutureType'),
            ],
            views: [{ id: 'viwTareas0000001', name: 'Todas', type: 'grid' }],
        },
    ];
}

function stockSchema() {
    return [
        {
            id: 'tblProductos00001',
            name: 'Productos',
            primaryFieldId: 'fldPrdNombre00001',
            fields: [
                f('fldPrdNombre00001', 'Producto', 'singleLineText'),
                f('fldPrdStock000001', 'Stock', 'number', { precision: 0 }),
            ],
            views: [],
        },
    ];
}

const pad = (n, w = 4) => String(n).padStart(w, '0');
const rec = (prefix, i) => `rec${prefix}${pad(i, 14 - prefix.length)}`;

function agencyRecords(memberEmail) {
    const member = { id: 'usrMiembro000001', email: memberEmail, name: 'Persona del equipo' };
    const outsider = { id: 'usrFreelance0001', email: 'luis@freelance.test', name: 'Luis Freelance' };
    const clientes = [];
    const nombres = ['Café Aurora', 'Ferretería El Tornillo', 'Clínica Sonrisa', 'Alcaldía de Rionegro', 'Grupo Andino', 'Panadería La Espiga', 'Constructora Altos', 'Moda Verde'];
    const segmentos = ['Pyme', 'Pyme', 'Pyme', 'Gobierno', 'Corporativo', 'Pyme', 'Corporativo', 'Pyme'];
    nombres.forEach((nombre, i) => {
        const fields = {
            fldCliNombre00001: nombre,
            fldCliCorreo00001: i === 6 ? 'esto-no-es-un-correo' : `contacto${i + 1}@cliente${i + 1}.co`,
            fldCliTelefono001: `+57 300 ${pad(100 + i, 3)} ${pad(2000 + i, 4)}`,
            fldCliWeb00000001: `https://cliente${i + 1}.co`,
            fldCliSegmento001: segmentos[i],
            fldCliNotas000001: i % 2 === 0 ? `Cliente desde 202${i % 4}.\nPrefiere que lo contacten por WhatsApp.` : undefined,
            fldCliActivo00001: i !== 3 ? true : undefined,
            fldCliEjecutivo01: member,
            fldCliAlta0000001: `2025-0${(i % 9) + 1}-1${i % 9}T14:3${i % 6}:00.000Z`,
        };
        if (i % 3 === 0) fields.fldCliEtiquetas01 = ['VIP', 'Recurrente'];
        else if (i % 3 === 1) fields.fldCliEtiquetas01 = ['Referido'];
        clientes.push({ id: rec('Cli', i + 1), createdTime: fields.fldCliAlta0000001, fields });
    });

    const estados = ['Propuesta', 'En curso', 'En curso', 'Pausado', 'Terminado', 'En curso'];
    const proyectos = [];
    for (let i = 0; i < 12; i++) {
        const cliente = clientes[i % clientes.length];
        const presupuesto = 4_000_000 + i * 750_000;
        const fields = {
            fldProNombre00001: `Proyecto ${['web', 'redes', 'marca', 'catálogo', 'campaña', 'app'][i % 6]} ${i + 1}`,
            fldProCliente0001: [cliente.id],
            fldProCodigo00001: i + 1,
            fldProPresupuest1: presupuesto,
            fldProAvance00001: Math.round((i * 9) % 100) / 100,
            fldProInicio00001: `2026-0${(i % 9) + 1}-0${(i % 8) + 1}`,
            fldProEntrega0001: `2026-1${i % 3}-1${i % 9}T2${i % 4}:30:00.000Z`,
            fldProEstado00001: estados[i % estados.length],
            fldProSatisfacc01: (i % 5) + 1,
            fldProDuracion001: (i + 1) * 5400,
            fldProDescripc001: `**Objetivo:** lanzar el proyecto ${i + 1}.\n\n- Reunión inicial\n- Entrega parcial`,
            fldProLider000001: i % 2 === 0 ? member : outsider,
            fldProMargen00001: Math.round(presupuesto * 0.3),
            fldProResumen0001: `Proyecto ${i + 1} · ${estados[i % estados.length]}`,
            fldProCorreoCli01: [cliente.fields.fldCliCorreo00001],
            fldProBoton000001: { label: 'Abrir', url: `https://drive.example.com/p${i + 1}` },
        };
        if (i === 11) fields.fldProMargen00001 = { specialValue: 'NaN' };
        proyectos.push({ id: rec('Pro', i + 1), createdTime: `2026-02-${pad((i % 27) + 1, 2)}T10:00:00.000Z`, fields });
    }
    // Vínculos inversos (Airtable los devuelve en los dos lados).
    for (const p of proyectos) {
        const c = clientes.find((x) => x.id === p.fields.fldProCliente0001[0]);
        (c.fields.fldCliProyectos01 ??= []).push(p.id);
    }

    const tareas = [];
    const attachments = new Map();
    let att = 0;
    const prioridades = ['Alta', 'Media', 'Baja'];
    for (let i = 0; i < 130; i++) {
        const proyecto = proyectos[i % proyectos.length];
        const fields = {
            fldTarTitulo00001: `Tarea ${pad(i + 1, 3)} de ${proyecto.fields.fldProNombre00001}`,
            fldTarProyecto001: [proyecto.id],
            fldTarHoras000001: Math.round(((i % 7) + 0.5) * 10) / 10,
            fldTarPrioridad01: prioridades[i % 3],
            fldTarVence000001: `2026-${pad((i % 12) + 1, 2)}-${pad((i % 27) + 1, 2)}`,
            fldTarCreadaPor01: i % 4 === 0 ? outsider : member,
            fldTarEditada0001: `2026-03-${pad((i % 27) + 1, 2)}T08:15:00.000Z`,
            fldTarBarras00001: { text: `770${pad(i, 10)}`, type: 'upce' },
            fldTarResumenIa01: { state: 'generated', value: `Resumen de la tarea ${i + 1}.`, isStale: false },
            fldTarNuevo000001: 'valor de un tipo que la app no conoce',
        };
        if (i % 2 === 0) fields.fldTarHecha000001 = true;
        if (i % 5 === 0) fields.fldTarAsignados01 = [member, outsider];
        else if (i % 5 === 1) fields.fldTarAsignados01 = [member];
        if (i < 6) {
            const files = [];
            const n = i === 0 ? 2 : 1;
            for (let k = 0; k < n; k++) {
                att++;
                const id = `att${pad(att, 14)}`;
                const isPdf = k === 1 || i === 3;
                const bytes = isPdf ? pdf(`Tarea ${i + 1}`) : png(24 + i * 4, 18 + i * 3, att);
                const filename = isPdf ? `acta-tarea-${i + 1}.pdf` : `boceto-${i + 1}.png`;
                attachments.set(id, { bytes, filename, type: isPdf ? 'application/pdf' : 'image/png' });
                files.push({ id, filename, size: bytes.length, type: isPdf ? 'application/pdf' : 'image/png' });
            }
            fields.fldTarArchivos001 = files;
        }
        if (i === 6) {
            // Un archivo que pasa del tope: nunca se baja.
            att++;
            const id = `att${pad(att, 14)}`;
            attachments.set(id, { bytes: Buffer.alloc(16), filename: 'video-entrega.mp4', type: 'video/mp4', declared: 40 * 1024 * 1024 });
            fields.fldTarArchivos001 = [{ id, filename: 'video-entrega.mp4', size: 40 * 1024 * 1024, type: 'video/mp4' }];
        }
        tareas.push({ id: rec('Tar', i + 1), createdTime: `2026-03-${pad((i % 27) + 1, 2)}T09:00:00.000Z`, fields });
    }
    for (const t of tareas) {
        const p = proyectos.find((x) => x.id === t.fields.fldTarProyecto001[0]);
        (p.fields.fldProTareas00001 ??= []).push(t.id);
    }
    for (const p of proyectos) {
        const ts = tareas.filter((t) => t.fields.fldTarProyecto001[0] === p.id);
        p.fields.fldProHoras000001 = Math.round(ts.reduce((s, t) => s + t.fields.fldTarHoras000001, 0) * 10) / 10;
        p.fields.fldProNTareas0001 = ts.length;
    }
    return { tables: { tblClientes000001: clientes, tblProyectos00001: proyectos, tblTareas00000001: tareas }, attachments };
}

function stockRecords() {
    return {
        tables: {
            tblProductos00001: [
                { id: rec('Prd', 1), createdTime: '2026-01-01T00:00:00.000Z', fields: { fldPrdNombre00001: 'Taza', fldPrdStock000001: 12 } },
                { id: rec('Prd', 2), createdTime: '2026-01-02T00:00:00.000Z', fields: { fldPrdNombre00001: 'Libreta', fldPrdStock000001: 4 } },
            ],
        },
        attachments: new Map(),
    };
}

// ── El servidor ─────────────────────────────────────────────────────────────

/**
 * Arranca el Airtable falso. `port: 0` = uno libre (los tests). Devuelve la
 * URL base y controles para las pruebas.
 */
export function startFakeAirtable(opts = {}) {
    const memberEmail = opts.memberEmail ?? 'e2e@test.local';
    const state = { rateLimit: opts.rateLimit ?? 0, retryAfter: opts.retryAfter ?? null, requests: 0, rateLimited: 0, attachmentsServed: 0, recordRequests: 0 };
    const bases = {
        [AGENCY_BASE]: { name: 'Agencia Creativa', schema: agencySchema(), data: agencyRecords(memberEmail) },
        [STOCK_BASE]: { name: 'Inventario', schema: stockSchema(), data: stockRecords() },
    };
    let baseUrl = '';

    const json = (res, code, body, headers = {}) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', ...headers });
        res.end(JSON.stringify(body));
    };
    const scopesOf = (req) => {
        const h = req.headers.authorization ?? '';
        if (h === `Bearer ${FULL_TOKEN}`) return ['data.records:read', 'schema.bases:read'];
        if (h === `Bearer ${DATA_ONLY_TOKEN}`) return ['data.records:read'];
        return null;
    };

    const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1');
        const path = url.pathname;
        state.requests++;

        if (path === '/__stats') return json(res, 200, state);
        if (path === '/__control' && req.method === 'POST') {
            let body = '';
            req.on('data', (c) => (body += c));
            req.on('end', () => {
                const b = body ? JSON.parse(body) : {};
                if (typeof b.rate_limit === 'number') state.rateLimit = b.rate_limit;
                if (b.retry_after !== undefined) state.retryAfter = b.retry_after;
                if (b.reset) Object.assign(state, { requests: 0, rateLimited: 0, attachmentsServed: 0, recordRequests: 0 });
                json(res, 200, state);
            });
            return undefined;
        }

        // Adjuntos (sin token: así sirve Airtable los suyos, por URL firmada).
        const am = /^\/att\/([^/]+)\/([^/]+)$/.exec(path);
        if (am) {
            for (const b of Object.values(bases)) {
                const a = b.data.attachments.get(am[1]);
                if (a) {
                    state.attachmentsServed++;
                    res.writeHead(200, { 'content-type': a.type, 'content-length': String(a.bytes.length) });
                    return res.end(a.bytes);
                }
            }
            return json(res, 404, { error: 'NOT_FOUND' });
        }

        const scopes = scopesOf(req);
        if (!scopes) return json(res, 401, { error: { type: 'AUTHENTICATION_REQUIRED', message: 'Authentication required' } });

        if (path === '/v0/meta/whoami') return json(res, 200, { id: 'usrDemoAgencia001', scopes });

        if (path === '/v0/meta/bases') {
            if (!scopes.includes('schema.bases:read')) {
                return json(res, 403, { error: { type: 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND', message: 'Invalid permissions, or the requested model was not found.' } });
            }
            return json(res, 200, { bases: Object.entries(bases).map(([id, b]) => ({ id, name: b.name, permissionLevel: 'create' })) });
        }

        const tm = /^\/v0\/meta\/bases\/([^/]+)\/tables$/.exec(path);
        if (tm) {
            const b = bases[tm[1]];
            if (!b || !scopes.includes('schema.bases:read')) {
                return json(res, 403, { error: { type: 'INVALID_PERMISSIONS_OR_MODEL_NOT_FOUND', message: 'Invalid permissions, or the requested model was not found.' } });
            }
            return json(res, 200, { tables: b.schema });
        }

        const rm = /^\/v0\/([^/]+)\/([^/]+)$/.exec(path);
        if (rm && req.method === 'GET') {
            state.recordRequests++;
            if (state.rateLimit > 0) {
                state.rateLimit--;
                state.rateLimited++;
                return json(
                    res,
                    429,
                    { errors: [{ error: 'RATE_LIMIT_REACHED', message: 'Rate limit exceeded. Please try again later' }] },
                    state.retryAfter !== null ? { 'retry-after': String(state.retryAfter) } : {},
                );
            }
            const b = bases[rm[1]];
            const tableKey = decodeURIComponent(rm[2]);
            const table = b?.schema.find((t) => t.id === tableKey || t.name === tableKey);
            if (!b || !table) return json(res, 404, { error: { type: 'TABLE_NOT_FOUND', message: 'Could not find table' } });
            const all = b.data.tables[table.id] ?? [];
            const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? 100)));
            const start = Number(url.searchParams.get('offset') ?? '0') || 0;
            const wanted = url.searchParams.getAll('fields[]');
            const byId = url.searchParams.get('returnFieldsByFieldId') === 'true';
            const page = all.slice(start, start + pageSize).map((r) => {
                const out = {};
                for (const [fid, v] of Object.entries(r.fields)) {
                    if (v === undefined) continue;
                    if (wanted.length && !wanted.includes(fid)) continue;
                    const field = table.fields.find((x) => x.id === fid);
                    let value = v;
                    if (field?.type === 'multipleAttachments') {
                        value = v.map((a) => ({ ...a, url: `${baseUrl}/att/${a.id}/${encodeURIComponent(a.filename)}` }));
                    }
                    out[byId ? fid : (field?.name ?? fid)] = value;
                }
                return { id: r.id, createdTime: r.createdTime, fields: out };
            });
            const next = start + pageSize < all.length ? String(start + pageSize) : undefined;
            return json(res, 200, next ? { records: page, offset: next } : { records: page });
        }

        return json(res, 404, { error: 'NOT_FOUND' });
    });

    return new Promise((resolve) => {
        server.listen(opts.port ?? 4896, '127.0.0.1', () => {
            const addr = server.address();
            baseUrl = `http://127.0.0.1:${addr.port}`;
            resolve({
                url: baseUrl,
                state,
                control(c) {
                    if (typeof c.rate_limit === 'number') state.rateLimit = c.rate_limit;
                    if (c.retry_after !== undefined) state.retryAfter = c.retry_after;
                },
                stop: () => new Promise((r) => server.close(() => r())),
            });
        });
    });
}

// Ejecutado directamente: arranca en el puerto pedido.
if (import.meta.url === `file://${process.argv[1]}`) {
    const port = Number(process.argv[2] ?? 4896);
    const s = await startFakeAirtable({
        port,
        memberEmail: process.env.FAKE_AIRTABLE_MEMBER_EMAIL ?? 'e2e@test.local',
        rateLimit: Number(process.env.FAKE_AIRTABLE_RATE_LIMIT ?? 0),
    });
    console.log(`Airtable simulado en ${s.url} (token ${FULL_TOKEN})`);
}
