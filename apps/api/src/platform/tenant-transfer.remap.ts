import { FILTER_OPERATORS, FORM_CONDITION_OPS, mapFlowChildLists, REQUIRED_IF_OPS, SHOW_IF_OPS } from '@imagina-base/shared';
import { cleanResolvedButtonConfig } from '../buttons/button-portable';

/**
 * Re-mapeo de ids al mover UNA empresa a otra instancia (v0.1.197, ADR-S23).
 *
 * Todos los ids de la app son `bigint generated always as identity` sobre
 * tablas COMPARTIDAS entre empresas: al insertar en el destino se regeneran,
 * así que cada referencia —tanto la de una columna como la que vive dentro de
 * un jsonb— tiene que traducirse. Lo que se olvide no falla ruidosamente:
 * apunta a datos de OTRA empresa o a nada, que es peor.
 *
 * Este módulo es PURO y está testeado aparte: es la pieza donde un descuido
 * cuesta datos cruzados, así que no puede depender de la base.
 */

/** Mapas viejo→nuevo por entidad. Una entidad ausente deja el id intacto. */
export interface IdMaps {
    list: Map<number, number>;
    field: Map<number, number>;
    record: Map<number, number>;
    user: Map<number, number>;
    attachment: Map<number, number>;
    connection: Map<number, number>;
    template: Map<number, number>;
    view: Map<number, number>;
    /** v0.1.266 — plantillas de documentos PDF. */
    document: Map<number, number>;
    /** v0.1.275 — formularios públicos (el disparador «Cuando se envía un formulario»). */
    form: Map<number, number>;
    /** C5 — flujos de aprobación (campo «Aprobación», disparador y acciones). */
    approval_flow: Map<number, number>;
    /** C5 — solicitudes de aprobación (las nombra la actividad del registro). */
    approval_request: Map<number, number>;
    /** C6 — plantillas de registro (formularios y acciones de automatización las nombran). */
    recordTemplate: Map<number, number>;
    /** C1 — equipos (valor del campo «Equipo», acceso por equipo, @equipo). */
    team: Map<number, number>;
    /** C2 — roles propios (`memberships.custom_role_id` y filas `custom:<id>` de los permisos). */
    customRole: Map<number, number>;
    /** D5 — páginas de agenda (el disparador «Cuando se agenda… una cita» las nombra). */
    bookingPage: Map<number, number>;
    /** E6 — agentes de IA (la acción «Pedirle a un agente» y la actividad que dejan). */
    agent: Map<number, number>;
    /** v0.1.367 — planes de suscripción (la acción «Crear suscripción» y el disparador). */
    subscriptionPlan: Map<number, number>;
}

export function emptyMaps(): IdMaps {
    return {
        list: new Map(),
        field: new Map(),
        record: new Map(),
        user: new Map(),
        attachment: new Map(),
        connection: new Map(),
        template: new Map(),
        view: new Map(),
        document: new Map(),
        form: new Map(),
        approval_flow: new Map(),
        approval_request: new Map(),
        recordTemplate: new Map(),
        team: new Map(),
        customRole: new Map(),
        bookingPage: new Map(),
        agent: new Map(),
        subscriptionPlan: new Map(),
    };
}

/** Traduce un id; si no está en el mapa devuelve `null` (referencia muerta). */
export function mapId(map: Map<number, number>, raw: unknown): number | null {
    const id = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isFinite(id)) return null;
    return map.get(id) ?? null;
}

// Claves cuyo valor es un id. Las dos primeras regex son las mismas que usa
// el blueprint de plantillas (`*_field_id` / `*_field_ids`), así que un campo
// nuevo que siga la convención queda cubierto sin tocar este archivo.
const FIELD_ID_KEY = /(^|_)field_id$/;
const FIELD_IDS_KEY = /(^|_)field_ids$/;
const LIST_ID_KEYS = new Set(['list_id', 'target_list_id']);
/** Arrays de field ids que NO terminan en `_field_ids` (computed). */
const FIELD_ID_ARRAY_KEYS = new Set(['inputs']);

/**
 * Claves que NO siguen ninguna convención y hay que nombrar a mano. Cada una
 * es un lugar donde el re-mapeo se olvidaría en silencio.
 */
const EXPLICIT: Record<string, keyof IdMaps> = {
    connection_id: 'connection',
    // v0.1.448 — la conexión de SMS o WhatsApp que manda el código de una firma.
    verify_connection_id: 'connection',
    default_template_id: 'template',
    view_id: 'view',
    // v0.1.265 — la firma del correo de una automatización (send_email).
    signature_user_id: 'user',
    // v0.1.266 — documentos PDF: la plantilla que usa una acción y las
    // imágenes subidas del diseño (logo, firma escaneada).
    document_template_id: 'document',
    file_id: 'attachment',
    // v0.1.275 — el formulario que filtra un disparador `form_submitted`.
    form_id: 'form',
    // v0.1.394 — el formulario de «WhatsApp con datos primero» de un widget de contacto.
    capture_form_id: 'form',
    // C5 — el flujo de aprobación de un campo «Aprobación», del disparador
    // «Cuando se aprueba o se rechaza» y de «Pedir / Esperar aprobación».
    approval_flow_id: 'approval_flow',
    // C6 — la plantilla de registro de un formulario y de las acciones
    // «Crear subtareas desde una plantilla» / «Crear un registro».
    record_template_id: 'recordTemplate',
    template_id: 'recordTemplate',
    // C1 — el equipo que aprueba un paso («Un equipo») de un flujo de aprobación
    // (y la copia de los pasos de cada solicitud).
    team_id: 'team',
    // D5 — la página de agenda que filtra el disparador `booking_event` y las
    // personas del equipo que atienden en una página de agenda.
    booking_page_id: 'bookingPage',
    staff_user_id: 'user',
    // v0.1.349 — la foto de quien atiende en una página de agenda.
    photo_file_id: 'attachment',
    // v0.1.369 — el logo propio de un formulario.
    logo_file_id: 'attachment',
    // D2/E5 — la persona que el SLA pone al escalar (campo Persona).
    escalate_set_user_id: 'user',
    // E6 — el agente de IA de la acción «Pedirle a un agente».
    agent_id: 'agent',
};
/** Arrays de ids con nombre propio que no son de listas. */
const EXPLICIT_ARRAYS: Record<string, keyof IdMaps> = {
    // v0.1.266 — PDFs adjuntos a un send_email.
    pdf_templates: 'document',
    // C5 — las personas que aprueban un paso de un flujo de aprobación.
    approver_user_ids: 'user',
    // v0.1.455 — entre quiénes reparte «Asignar por turno».
    assignee_user_ids: 'user',
    // D2/E5 — a quién avisa y a quién escala el SLA de la mesa de ayuda.
    notify_user_ids: 'user',
    escalate_user_ids: 'user',
    notify_team_ids: 'team',
    escalate_team_ids: 'team',
    // E6 — quienes revisan las propuestas de un agente de IA.
    reviewer_user_ids: 'user',
    // v0.1.447 — las plantillas de documento que filtra «Cuando cambia una firma».
    signature_template_ids: 'document',
    // v0.1.367 — los planes que filtra el disparador «Cuando cambia una suscripción».
    plan_ids: 'subscriptionPlan',
};
/**
 * v0.1.367 — ids que pueden venir como texto LIBRE (el plan de la acción
 * «Crear suscripción» vive en `values`, que admite variables): sólo se
 * traduce si es un número; si no, queda como estaba.
 */
const NUMERIC_ONLY: Record<string, keyof IdMaps> = {
    plan_id: 'subscriptionPlan',
    // La lista destino de «Crear un registro» la guardan el editor y el
    // asistente como `target_list` (no sigue la convención `*_list_id`): sin
    // esto llegaba con el id del origen y la acción fallaba («la lista destino
    // no existe») o, en otro servidor, creaba en OTRA lista de la empresa.
    target_list: 'list',
};
/** Arrays de list ids con nombre propio. */
const LIST_ID_ARRAY_KEYS = new Set(['related_lists']);
/**
 * v0.1.351 — Objetos cuyos VALORES son ids (las claves son texto libre): la
 * imagen de cada opción de una pregunta (`valor de la opción → archivo`).
 */
const ID_VALUE_RECORDS: Record<string, keyof IdMaps> = {
    option_images: 'attachment',
};

/**
 * Recorre un jsonb traduciendo toda referencia conocida. Un id que no resuelve
 * queda en `null` (y el caller decide): dejarlo apuntando al número viejo
 * sería apuntar a la fila de otra empresa.
 *
 * `list_id: 0` se conserva: los widgets de CONTENIDO de un tablero lo usan
 * como "sin lista" y mapearlo a null rompería el widget.
 */
export function remapJson(value: unknown, maps: IdMaps): unknown {
    if (Array.isArray(value)) return value.map((v) => remapJson(v, maps));
    if (value === null || typeof value !== 'object') return value;

    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
        const explicit = EXPLICIT[key];
        if (explicit) {
            out[key] = raw === null || raw === undefined ? raw : mapId(maps[explicit], raw);
        } else if (NUMERIC_ONLY[key] && (typeof raw === 'number' || (typeof raw === 'string' && /^\d+$/.test(raw.trim())))) {
            const id = mapId(maps[NUMERIC_ONLY[key]!], raw);
            out[key] = id === null ? null : typeof raw === 'string' ? String(id) : id;
        } else if (FIELD_ID_KEY.test(key)) {
            out[key] = raw === null || raw === undefined ? raw : mapId(maps.field, raw);
        } else if (FIELD_IDS_KEY.test(key) || FIELD_ID_ARRAY_KEYS.has(key)) {
            out[key] = Array.isArray(raw)
                ? raw.map((v) => mapId(maps.field, v)).filter((v): v is number => v !== null)
                : raw;
        } else if (LIST_ID_KEYS.has(key)) {
            // 0 = widget de contenido sin lista.
            out[key] = raw === 0 ? 0 : raw === null || raw === undefined ? raw : mapId(maps.list, raw);
        } else if (EXPLICIT_ARRAYS[key]) {
            const map = maps[EXPLICIT_ARRAYS[key]!];
            out[key] = Array.isArray(raw)
                ? raw.map((v) => mapId(map, v)).filter((v): v is number => v !== null)
                : raw;
        } else if (LIST_ID_ARRAY_KEYS.has(key)) {
            out[key] = Array.isArray(raw)
                ? raw.map((v) => mapId(maps.list, v)).filter((v): v is number => v !== null)
                : raw;
        } else if (ID_VALUE_RECORDS[key] && raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
            const map = maps[ID_VALUE_RECORDS[key]!];
            const next: Record<string, number> = {};
            for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
                const id = mapId(map, v);
                if (id !== null) next[k] = id;
            }
            out[key] = next;
        } else {
            out[key] = remapJson(raw, maps);
        }
    }
    return out;
}

/**
 * `records.data`: las CLAVES son `f{field_id}` y hay dos tipos cuyo VALOR es
 * un id de otra tabla — `file` (lista de adjuntos) y `user`. El resto es dato
 * puro. Un campo que ya no existe se descarta con su valor.
 */
export function remapRecordData(
    data: Record<string, unknown>,
    fieldTypeByOldId: Map<number, string>,
    maps: IdMaps,
): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
        const match = /^f(\d+)$/.exec(key);
        if (!match?.[1]) {
            // Clave que no es de campo: se conserva tal cual (nunca hubo).
            out[key] = value;
            continue;
        }
        const oldFieldId = Number(match[1]);
        const newFieldId = maps.field.get(oldFieldId);
        if (newFieldId === undefined) continue;
        const type = fieldTypeByOldId.get(oldFieldId) ?? '';
        out[`f${newFieldId}`] = remapFieldValue(value, type, maps);
    }
    return out;
}

function remapFieldValue(value: unknown, type: string, maps: IdMaps): unknown {
    if (type === 'file') {
        // Tolera escalar además de array: así lo escribe el import viejo.
        const ids = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
        const mapped = ids.map((v) => mapId(maps.attachment, v)).filter((v): v is number => v !== null);
        return Array.isArray(value) ? mapped : (mapped[0] ?? null);
    }
    if (type === 'user') {
        return value === null || value === undefined ? value : mapId(maps.user, value);
    }
    // C1 — el campo «Equipo» guarda un array de ids de equipo.
    if (type === 'team') {
        const ids = Array.isArray(value) ? value : value === null || value === undefined ? [] : [value];
        const mapped = ids.map((v) => mapId(maps.team, v)).filter((v): v is number => v !== null);
        return mapped.length > 0 ? mapped : null;
    }
    return value;
}

/**
 * El documento del registro apunta a personas, a otros registros y a archivos.
 * Se recorre el árbol completo porque esos nodos pueden estar anidados dentro
 * de columnas, listas o tablas.
 */
export function remapRichDoc(doc: unknown, maps: IdMaps): unknown {
    if (Array.isArray(doc)) return doc.map((d) => remapRichDoc(d, maps));
    if (doc === null || typeof doc !== 'object') return doc;
    const node = doc as Record<string, unknown>;
    const out: Record<string, unknown> = { ...node };

    const attrs = node.attrs;
    if (attrs !== null && typeof attrs === 'object') {
        const a = { ...(attrs as Record<string, unknown>) };
        if (node.type === 'mentionUser') a.id = mapId(maps.user, a.id);
        if (node.type === 'mentionTeam') a.id = mapId(maps.team, a.id);
        if (node.type === 'mentionRecord') a.id = mapId(maps.record, a.id);
        if (node.type === 'imageBlock' || node.type === 'fileBlock') {
            a.fileId = mapId(maps.attachment, a.fileId);
        }
        out.attrs = a;
    }
    if (Array.isArray(node.content)) out.content = node.content.map((c) => remapRichDoc(c, maps));
    return out;
}

// ── Condiciones que nombran a una persona o a un equipo ────────────────────

/**
 * Los FILTROS y las CONDICIONES apuntan a su campo por id (`field_id`, que
 * traduce `remapJson` por convención) o por slug (automatizaciones), pero su
 * VALOR es dato: en un campo Persona («Responsable es Ana») ese dato es el id
 * de una persona, y en un campo Equipo («Equipo es Ventas») el de un equipo, y
 * los dos se regeneran al importar. Sin esto, la vista «Lo de Ana» del
 * servidor nuevo mostraba lo de quien tuviera aquí el número viejo de Ana.
 *
 * Regla (la misma en todos los lugares): un id que resuelve se cambia por el
 * nuevo; uno que no resuelve (esa persona o ese equipo no viajó) se QUITA de la
 * lista, y si la condición se queda sin valor se DESCARTA entera: nunca queda
 * con el número viejo. Lo que no es un id se conserva tal cual: el «Yo» de los
 * equipos (`$my_teams`), las variables de una automatización (`{{…}}`) y el
 * `0` de «Sistema» en «Modificado por». (El «Yo» de una persona se guarda como
 * su id y se traduce como cualquier otro.)
 */

/** Tipos cuyo valor guardado es el id de una persona. */
const PERSON_VALUE_TYPES = new Set(['user', 'created_by', 'updated_by']);

/** Cuenta las condiciones que se descartaron (para avisar o pausar). */
export interface ConditionRemapReport {
    dropped: number;
}

/** El mapa con el que se traduce el valor de una condición sobre un campo de este tipo (o null si no hace falta). */
export function conditionValueMap(type: string, maps: IdMaps): Map<number, number> | null {
    if (PERSON_VALUE_TYPES.has(type)) return maps.user;
    if (type === 'team') return maps.team;
    return null;
}

const DROP_VALUE = Symbol('drop-value');

/** Un elemento del valor: el id nuevo, `DROP_VALUE` si no viajó, o el original si no es un id. */
function remapConditionId(raw: unknown, map: Map<number, number>): unknown {
    if (typeof raw === 'number') {
        if (!Number.isInteger(raw) || raw <= 0) return raw;
        return map.get(raw) ?? DROP_VALUE;
    }
    if (typeof raw === 'string' && /^\s*\d+\s*$/.test(raw)) {
        const n = Number(raw);
        if (n <= 0) return raw;
        const id = map.get(n);
        return id === undefined ? DROP_VALUE : String(id);
    }
    return raw;
}

/**
 * LA función que traduce el VALOR de una condición sobre un campo de tipo
 * `type` (la usan todos los lugares de abajo). Devuelve el valor nuevo, o
 * `null` si la condición se queda sin valor y hay que descartarla. Un valor
 * vacío (condición a medio armar) se conserva: no nombra a nadie.
 */
export function remapConditionValue(value: unknown, type: string, maps: IdMaps): { value: unknown } | null {
    const map = conditionValueMap(type, maps);
    if (!map) return { value };
    if (Array.isArray(value)) {
        const out = value.map((v) => remapConditionId(v, map)).filter((v) => v !== DROP_VALUE);
        return value.length > 0 && out.length === 0 ? null : { value: out };
    }
    const one = remapConditionId(value, map);
    return one === DROP_VALUE ? null : { value: one };
}

/** Los operadores de una condición por `field_id` (filtros, colores, «Mostrar sólo si…», «Obligatorio si…»). */
const CONDITION_OPS = new Set<string>([...FILTER_OPERATORS, ...SHOW_IF_OPS, ...FORM_CONDITION_OPS, ...REQUIRED_IF_OPS]);

const DROP_NODE = Symbol('drop-node');

function isIdCondition(o: Record<string, unknown>): boolean {
    if (o.type !== undefined && o.type !== 'condition') return false;
    if (typeof o.op !== 'string' || !CONDITION_OPS.has(o.op)) return false;
    if (typeof o.field_id !== 'number' && typeof o.field_id !== 'string') return false;
    const id = Number(o.field_id);
    return Number.isInteger(id) && id > 0;
}

/**
 * Recorre un jsonb y traduce el valor de toda condición por `field_id`, con el
 * tipo del campo por su id VIEJO: corre ANTES de `remapJson`, que es quien
 * cambia los `field_id`. Cubre, sin nombrarlos uno por uno, el `filter_tree`
 * de las vistas, los tableros, los informes, los filtros guardados, los
 * documentos, los resúmenes (rollup), el «Deshabilitado si…» de un botón, los
 * diseños de la ficha y del portal y las automatizaciones (`records_filter`,
 * `match_filter`, «Editar en lote», «Repetir por cada vinculado»); el espejo
 * `filters` de las vistas; las reglas de color; el «Mostrar sólo si…» y el
 * «Obligatorio si…» de los campos, y las condiciones de los formularios.
 *
 * Una condición descartada sale de su lista; un grupo anidado que queda vacío
 * por eso también se va (un grupo vacío no filtra nada, como en
 * `cleanDocItemsFilter`) y la raíz se conserva aunque quede vacía; una regla de
 * color sin su condición se va entera, y una condición suelta (`required_if`,
 * `show_if`, el `when` de un formulario) queda en `null` («no aplica»).
 */
export function remapIdConditions(
    value: unknown,
    fieldTypeByOldId: Map<number, string>,
    maps: IdMaps,
    report?: ConditionRemapReport,
): unknown {
    const out = walkIdConditions(value, fieldTypeByOldId, maps, report ?? { dropped: 0 }, null);
    return out === DROP_NODE ? null : out;
}

function walkIdConditions(
    value: unknown,
    types: Map<number, string>,
    maps: IdMaps,
    report: ConditionRemapReport,
    parentKey: string | null,
): unknown {
    if (Array.isArray(value)) {
        const out: unknown[] = [];
        for (const v of value) {
            const r = walkIdConditions(v, types, maps, report, parentKey);
            if (r !== DROP_NODE) out.push(r);
        }
        return out;
    }
    if (value === null || typeof value !== 'object') return value;
    const o = value as Record<string, unknown>;
    if (isIdCondition(o)) {
        if (!('value' in o)) return o;
        const res = remapConditionValue(o.value, types.get(Number(o.field_id)) ?? '', maps);
        if (res === null) {
            report.dropped += 1;
            return DROP_NODE;
        }
        return res.value === o.value ? o : { ...o, value: res.value };
    }
    const out: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(o)) {
        const r = walkIdConditions(raw, types, maps, report, key);
        if (r === DROP_NODE) {
            // Una regla de color (`{condition, color}`) sin su condición no es nada.
            if (key === 'condition') return DROP_NODE;
            out[key] = null;
        } else {
            out[key] = r;
        }
    }
    const emptied = (key: string): boolean =>
        Array.isArray(o[key]) && (o[key] as unknown[]).length > 0 && Array.isArray(out[key]) && (out[key] as unknown[]).length === 0;
    // El grupo anidado de un filtro (la raíz se conserva, aunque quede vacía).
    if (o.type === 'group' && parentKey === 'children' && emptied('children')) return DROP_NODE;
    // El grupo «todas / alguna» de un formulario: sin reglas no es válido.
    if (typeof o.match === 'string' && emptied('rules')) return DROP_NODE;
    // El «Mostrar sólo si…» de un campo: sin condiciones, se muestra siempre.
    if (typeof o.logic === 'string' && !('children' in o) && emptied('conditions')) return DROP_NODE;
    return out;
}

/**
 * Lo que hace falta para saber el TIPO del campo de una condición que lo
 * nombra por SLUG (las automatizaciones), y la lista de los vinculados de una
 * relación. Todo por ids VIEJOS.
 */
export interface ConditionFieldIndex {
    byId: Map<number, { type: string; listId: number; targetListId: number | null }>;
    /** Lista vieja → slug → tipo. */
    bySlug: Map<number, Map<string, string>>;
    /** Id viejo → tipo (lo que pide `remapIdConditions`). */
    types: Map<number, string>;
}

export function buildConditionFieldIndex(
    rows: Iterable<{ id?: unknown; listId?: unknown; slug?: unknown; type?: unknown; config?: unknown }>,
): ConditionFieldIndex {
    const byId: ConditionFieldIndex['byId'] = new Map();
    const bySlug: ConditionFieldIndex['bySlug'] = new Map();
    const types: ConditionFieldIndex['types'] = new Map();
    for (const f of rows) {
        const id = Number(f.id);
        const listId = Number(f.listId);
        if (!Number.isFinite(id) || !Number.isFinite(listId)) continue;
        const type = String(f.type ?? '');
        const target = Number((f.config as { target_list_id?: unknown } | null | undefined)?.target_list_id);
        byId.set(id, { type, listId, targetListId: Number.isInteger(target) && target > 0 ? target : null });
        types.set(id, type);
        if (typeof f.slug === 'string') {
            let bySlugOfList = bySlug.get(listId);
            if (!bySlugOfList) {
                bySlugOfList = new Map();
                bySlug.set(listId, bySlugOfList);
            }
            bySlugOfList.set(f.slug, type);
        }
    }
    return { byId, bySlug, types };
}

/** De qué lista son los slugs: la del registro que disparó y, dentro de un bucle, la del vinculado (`item.`). */
interface SlugScope {
    listId: number | null;
    itemListId: number | null;
}

function slugTypeOf(index: ConditionFieldIndex, scope: SlugScope, token: unknown): string {
    if (typeof token !== 'string') return '';
    let slug = token.trim();
    let listId = scope.listId;
    if (slug.startsWith('before.')) {
        slug = slug.slice('before.'.length);
    } else if (slug.startsWith('item.')) {
        slug = slug.slice('item.'.length);
        listId = scope.itemListId;
    } else if (slug.includes('.')) {
        // `respuestas.x`, `comentario.x`, `campo.email`…: no guardan un id.
        return '';
    }
    if (listId === null) return '';
    return index.bySlug.get(listId)?.get(slug) ?? '';
}

/**
 * Una condición por slug (`[{field|slug, op, value}]` unidas por «y», o la
 * legacy `{slug: valor}`): traduce el valor de las reglas sobre un campo
 * Persona o Equipo; la que se queda sin valor se descarta.
 */
function remapSlugCondition(cond: unknown, typeOf: (token: unknown) => string, maps: IdMaps, report: ConditionRemapReport): unknown {
    if (Array.isArray(cond)) {
        return cond.flatMap((rule) => {
            if (!rule || typeof rule !== 'object' || !('value' in rule)) return [rule];
            const r = rule as Record<string, unknown>;
            const res = remapConditionValue(r.value, typeOf(r.field ?? r.slug), maps);
            if (res === null) {
                report.dropped += 1;
                return [];
            }
            return [res.value === r.value ? r : { ...r, value: res.value }];
        });
    }
    if (cond !== null && typeof cond === 'object') {
        const out: Record<string, unknown> = {};
        for (const [slug, v] of Object.entries(cond as Record<string, unknown>)) {
            const res = remapConditionValue(v, typeOf(slug), maps);
            if (res === null) {
                report.dropped += 1;
                continue;
            }
            out[slug] = res.value;
        }
        return out;
    }
    return cond;
}

/** La lista (vieja) de los registros vinculados por una relación, vista desde `listId` (en cualquier sentido). */
function linkedListOf(index: ConditionFieldIndex, relationFieldId: unknown, listId: number | null): number | null {
    const f = index.byId.get(Number(relationFieldId));
    if (!f) return null;
    return f.listId === listId ? f.targetListId : f.listId;
}

function oldListIdOf(raw: unknown): number | null {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function remapStepSlugConditions(
    raw: unknown,
    scope: SlugScope,
    index: ConditionFieldIndex,
    maps: IdMaps,
    report: AutomationRemapReport,
): unknown {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
    const step: Record<string, unknown> = { ...(raw as Record<string, unknown>) };
    const typeOf = (token: unknown): string => slugTypeOf(index, scope, token);
    // «Continuar sólo si…» de cada paso.
    if (step.condition !== undefined) step.condition = remapSlugCondition(step.condition, typeOf, maps, report);
    const type = String(step.type ?? '');
    let eachScope: SlugScope = scope;
    if (step.config && typeof step.config === 'object' && !Array.isArray(step.config)) {
        const cfg: Record<string, unknown> = { ...(step.config as Record<string, unknown>) };
        // «Si / sino», «Comprobar y detener» y la reanudación de «Esperar».
        for (const key of ['condition', 'resume_condition'] as const) {
            if (cfg[key] !== undefined) cfg[key] = remapSlugCondition(cfg[key], typeOf, maps, report);
        }
        // «Buscar registros»: los slugs son de la lista donde se busca.
        if (type === 'find_records' && cfg.conditions !== undefined) {
            const where: SlugScope = { listId: oldListIdOf(cfg.list_id ?? cfg.target_list) ?? scope.listId, itemListId: scope.itemListId };
            cfg.conditions = remapSlugCondition(cfg.conditions, (t) => slugTypeOf(index, where, t), maps, report);
        }
        // «Según el valor de…»: una rama que se queda sin valor conserva sus
        // pasos (sin valor no se puede activar: el editor pide elegir otro).
        if (type === 'switch' && Array.isArray(cfg.cases)) {
            const sourceType =
                cfg.source_field_id !== undefined && cfg.source_field_id !== null
                    ? (index.byId.get(Number(cfg.source_field_id))?.type ?? '')
                    : typeOf(cfg.source_variable);
            cfg.cases = cfg.cases.map((c) => {
                if (!c || typeof c !== 'object' || !('value' in c)) return c;
                const kase = c as Record<string, unknown>;
                const res = remapConditionValue(kase.value, sourceType, maps);
                if (res === null) {
                    report.dropped += 1;
                    return { ...kase, value: null };
                }
                return res.value === kase.value ? kase : { ...kase, value: res.value };
            });
        }
        if (type === 'create_record') {
            const target = oldListIdOf(cfg.target_list);
            if (target !== null && !maps.list.has(target)) report.lostTargets += 1;
        }
        // «Repetir por cada vinculado»: adentro, `item.<slug>` es de la otra lista.
        if (type === 'for_each_linked') {
            eachScope = { listId: scope.listId, itemListId: linkedListOf(index, cfg.relation_field_id, scope.listId) };
        }
        step.config = cfg;
    }
    return mapFlowChildLists(step, (acts, branch) =>
        acts.map((a) => remapStepSlugConditions(a, branch === 'each' ? eachScope : scope, index, maps, report)),
    );
}

/** Lo que una automatización perdió al importarse (quien importa la pausa y avisa). */
export interface AutomationRemapReport extends ConditionRemapReport {
    /** «Crear un registro» cuya lista destino no viajó (en `null` crearía en la lista propia). */
    lostTargets: number;
}

/** Para traducir las condiciones de una automatización (todo por ids VIEJOS). */
export interface AutomationConditionContext {
    /** La lista de la automatización: de ahí son los slugs de sus condiciones. */
    listId: number;
    index: ConditionFieldIndex;
    report?: AutomationRemapReport;
}

/**
 * Las condiciones de una automatización: las del disparador (`field_filters`
 * y el «de / a» de «Cuando cambia un campo») y las de cada paso en todas sus
 * ramas (por slug), más las que van por `field_id` (`remapIdConditions`).
 */
function remapAutomationConditions(
    triggerConfig: Record<string, unknown>,
    actions: unknown,
    maps: IdMaps,
    ctx: AutomationConditionContext,
): { triggerConfig: Record<string, unknown>; actions: unknown } {
    const report = ctx.report ?? { dropped: 0, lostTargets: 0 };
    const types = ctx.index.types;
    const scope: SlugScope = { listId: ctx.listId, itemListId: null };
    const typeOf = (token: unknown): string => slugTypeOf(ctx.index, scope, token);
    const trigger: Record<string, unknown> = { ...triggerConfig };
    if (trigger.field_filters !== undefined) trigger.field_filters = remapSlugCondition(trigger.field_filters, typeOf, maps, report);
    const changedType = typeOf(trigger.field);
    for (const key of ['from_value', 'to_value'] as const) {
        if (trigger[key] === undefined || trigger[key] === null) continue;
        const res = remapConditionValue(trigger[key], changedType, maps);
        if (res === null) {
            report.dropped += 1;
            trigger[key] = null;
        } else {
            trigger[key] = res.value;
        }
    }
    const steps = Array.isArray(actions) ? actions.map((a) => remapStepSlugConditions(a, scope, ctx.index, maps, report)) : actions;
    return {
        triggerConfig: remapIdConditions(trigger, types, maps, report) as Record<string, unknown>,
        actions: remapIdConditions(steps, types, maps, report),
    };
}

/**
 * `lists.settings` mezcla tres vocabularios: ids por convención (los cubre
 * `remapJson`), SLUGS (que no se tocan porque viajan con el campo) y dos
 * lugares con forma propia: las CLAVES de `permissions.users` son ids de
 * usuario, y el token público es una credencial de la instancia vieja.
 *
 * Con `conditions`, además, los filtros de los bloques de la ficha y del portal
 * («Vinculados», «Gráfico») traducen sus personas y equipos.
 */
export function remapListSettings(
    settings: Record<string, unknown>,
    maps: IdMaps,
    newPublicToken: string | null,
    conditions?: { fieldTypeByOldId: Map<number, string>; report?: ConditionRemapReport },
): Record<string, unknown> {
    const source = conditions
        ? (remapIdConditions(settings, conditions.fieldTypeByOldId, maps, conditions.report) as Record<string, unknown>)
        : settings;
    const out = remapJson(source, maps) as Record<string, unknown>;

    const permissions = out.permissions;
    if (permissions !== null && typeof permissions === 'object') {
        const p = { ...(permissions as Record<string, unknown>) };
        const users = p.users;
        if (users !== null && typeof users === 'object') {
            const remapped: Record<string, unknown> = {};
            for (const [oldUserId, perms] of Object.entries(users as Record<string, unknown>)) {
                const newId = mapId(maps.user, oldUserId);
                // Un acceso individual de alguien que no viajó se descarta:
                // dejarlo con el id viejo se lo daría a OTRA persona.
                if (newId !== null) remapped[String(newId)] = perms;
            }
            p.users = remapped;
        }
        // C1 — las CLAVES de `permissions.teams` son ids de equipo.
        const teams = p.teams;
        if (teams !== null && typeof teams === 'object') {
            const remapped: Record<string, unknown> = {};
            for (const [oldTeamId, perms] of Object.entries(teams as Record<string, unknown>)) {
                const newId = mapId(maps.team, oldTeamId);
                if (newId !== null) remapped[String(newId)] = perms;
            }
            p.teams = remapped;
        }
        // C2 — las filas de roles PROPIOS van por clave `custom:<id>`.
        const rolePerms = p.permissions;
        if (rolePerms !== null && typeof rolePerms === 'object') {
            const remapped: Record<string, unknown> = {};
            for (const [key, perms] of Object.entries(rolePerms as Record<string, unknown>)) {
                const m = /^custom:(\d+)$/.exec(key);
                if (!m) {
                    remapped[key] = perms;
                    continue;
                }
                // Una fila de un rol que no viajó se descarta (heredaría otro rol).
                const newId = mapId(maps.customRole, m[1]);
                if (newId !== null) remapped[`custom:${newId}`] = perms;
            }
            p.permissions = remapped;
        }
        out.permissions = p;
    }

    // v0.1.333 — la marca de una lista espejo (tienda o sitio WordPress) lleva
    // un mapa columna → id de campo cuyas CLAVES son nombres («title»,
    // «acf:precio»): `remapJson` no lo ve. La sincronización la rearma en la
    // próxima corrida, pero si la conexión llega sin su credencial esa corrida
    // no ocurre, y los candados quedarían apuntando a campos de otra empresa.
    for (const key of ['store_sync', 'site_sync'] as const) {
        const marker = out[key];
        if (marker === null || typeof marker !== 'object' || Array.isArray(marker)) continue;
        const m = { ...(marker as Record<string, unknown>) };
        const fields = m.fields;
        if (fields !== null && typeof fields === 'object' && !Array.isArray(fields)) {
            const remapped: Record<string, number> = {};
            for (const [column, oldId] of Object.entries(fields as Record<string, unknown>)) {
                const id = mapId(maps.field, oldId);
                if (id !== null) remapped[column] = id;
            }
            m.fields = remapped;
        }
        out[key] = m;
    }

    // v0.1.412 (ADR-S103) — la tienda no viaja: las listas de sus pedidos
    // llegan como listas comunes (sin columnas protegidas por una tienda que
    // no existe en este servidor).
    delete out.shop_orders_of;
    // v0.1.452 — tampoco la lista de cobro de una agencia (la agencia no viaja).
    delete out.agency_clients_of;

    // v0.1.371 — las columnas de cobro (v0.1.365), de suscripción (v0.1.367) y
    // del registro de cobros (v0.1.371) son mapas `dato → id de campo` cuyas
    // CLAVES son nombres («status», «link»): `remapJson` no los ve.
    for (const key of ['collections', 'subscriptions', 'subscription_charges'] as const) {
        const block = out[key];
        if (block === null || typeof block !== 'object' || Array.isArray(block)) continue;
        const b = { ...(block as Record<string, unknown>) };
        const fields = (settings[key] as Record<string, unknown> | undefined)?.fields;
        if (fields !== null && typeof fields === 'object' && !Array.isArray(fields)) {
            const remapped: Record<string, number | null> = {};
            for (const [role, oldId] of Object.entries(fields as Record<string, unknown>)) {
                remapped[role] = oldId === null || oldId === undefined ? null : mapId(maps.field, oldId);
            }
            b.fields = remapped;
        }
        // El tablero del registro de cobros se re-crea a mano: el id viejo es de la otra instancia.
        if (key === 'subscription_charges') b.dashboard_id = null;
        out[key] = b;
    }

    const pub = out.public;
    if (pub !== null && typeof pub === 'object') {
        // El token es la credencial del enlace público: se emite uno nuevo en
        // el destino (el viejo apunta a la instancia de origen).
        out.public = { ...(pub as Record<string, unknown>), token: newPublicToken ?? '' };
    }
    return out;
}

/**
 * v0.1.386 — La configuración de un formulario: lo genérico (`remapJson`) más
 * los VALORES fijos de «Origen y etiquetas» que son ids de otra cosa: una
 * persona (campo Persona) o un equipo (campo Equipo). Uno que no viajó se
 * descarta (dejarlo le asignaría el registro a OTRA persona).
 *
 * Las condiciones («Mostrar sólo si…», saltos y pantallas finales) sobre una
 * pregunta de Equipo traducen su valor con `remapIdConditions`. Un salto cuya
 * condición se descartó se quita: con `when: null` saltaría SIEMPRE.
 */
export function remapFormConfig(
    original: Record<string, unknown>,
    fieldTypeByOldId: Map<number, string>,
    maps: IdMaps,
    report?: ConditionRemapReport,
): Record<string, unknown> {
    const config = remapIdConditions(original, fieldTypeByOldId, maps, report) as Record<string, unknown>;
    const jumpsBefore = (original.settings as Record<string, unknown> | undefined)?.jumps;
    const jumpsAfter = (config.settings as Record<string, unknown> | undefined)?.jumps;
    if (Array.isArray(jumpsBefore) && Array.isArray(jumpsAfter) && jumpsBefore.length === jumpsAfter.length) {
        (config.settings as Record<string, unknown>).jumps = jumpsAfter.filter((j, i) => {
            const was = (jumpsBefore[i] as { when?: unknown } | null)?.when;
            const now = (j as { when?: unknown } | null)?.when;
            return !(was !== null && was !== undefined && (now === null || now === undefined));
        });
    }
    const before = (config.settings as Record<string, unknown> | undefined)?.record_values as { fixed?: unknown } | undefined;
    const typeOfOld = new Map<number, string>();
    if (before && Array.isArray(before.fixed)) {
        for (const fv of before.fixed as Array<{ field_id?: unknown }>) {
            const id = Number(fv?.field_id);
            if (Number.isFinite(id)) typeOfOld.set(id, fieldTypeByOldId.get(id) ?? '');
        }
    }
    const out = remapJson(config, maps) as Record<string, unknown>;
    const rv = (out.settings as Record<string, unknown> | undefined)?.record_values as { fixed?: unknown } | undefined;
    if (!rv || !Array.isArray(rv.fixed) || !before || !Array.isArray(before.fixed)) return out;
    const oldFixed = before.fixed as Array<{ field_id?: unknown; value?: unknown }>;
    rv.fixed = (rv.fixed as Array<{ field_id?: unknown; value?: unknown }>).flatMap((fv, i) => {
        const type = typeOfOld.get(Number(oldFixed[i]?.field_id)) ?? '';
        if (type !== 'user' && type !== 'team') return [fv];
        const map = type === 'user' ? maps.user : maps.team;
        const one = (v: unknown): number | null => mapId(map, v);
        if (Array.isArray(fv.value)) {
            const ids = fv.value.map(one).filter((x): x is number => x !== null);
            return ids.length ? [{ ...fv, value: ids }] : [];
        }
        const id = one(fv.value);
        return id === null ? [] : [{ ...fv, value: id }];
    });
    return out;
}

/**
 * v0.1.395 — Config de un widget de contacto. `remapJson` cubre el formulario
 * de captura, el campo donde se asigna el registro y los formularios/agendas
 * de cada botón; lo que no sigue ninguna convención es el usuario del equipo
 * de cada persona que atiende el WhatsApp (`advisors[].user_id`). Una que no
 * viajó queda sin usuario (su número sigue): dejar el id viejo le asignaría
 * los registros a OTRA persona.
 */
export function remapWidgetConfig(config: Record<string, unknown>, maps: IdMaps): Record<string, unknown> {
    const out = remapJson(config, maps) as Record<string, unknown>;
    if (!Array.isArray(out.buttons)) return out;
    out.buttons = (out.buttons as unknown[]).map((raw) => {
        if (!raw || typeof raw !== 'object') return raw;
        // v0.1.419 — Las tiendas no viajan al migrar una empresa: el botón
        // «Ver la tienda» queda sin tienda (el editor pide elegirla de nuevo).
        const b = 'shop_id' in raw ? { ...(raw as Record<string, unknown>), shop_id: null } : raw;
        if (!Array.isArray((b as { advisors?: unknown }).advisors)) return b;
        const btn = b as { advisors: unknown[] };
        return {
            ...btn,
            advisors: btn.advisors.map((a) => {
                if (!a || typeof a !== 'object') return a;
                const adv = a as { user_id?: unknown };
                return adv.user_id === null || adv.user_id === undefined ? adv : { ...adv, user_id: mapId(maps.user, adv.user_id) };
            }),
        };
    });
    return out;
}

/**
 * v0.1.297 — Config de una vista guardada. Los ids de campo los cubre `remapJson`
 * por convención (`kanban_value_field_id`, `required_field_ids`…); lo que no
 * sigue ninguna son las CLAVES de columna y carril del kanban cuando el campo
 * es una PERSONA: la clave es su id de usuario como texto («30»). Se traducen
 * con el mapa de usuarios; una que no viajó se descarta (dejarla le aplicaría
 * el límite o el plegado a OTRA persona). `fieldTypeByOldId` es por el id
 * VIEJO del campo. Los filtros de la vista (`filter_tree`, su espejo `filters`)
 * y las reglas de color traducen sus personas y equipos (`remapIdConditions`).
 */
export function remapViewConfig(
    config: Record<string, unknown>,
    fieldTypeByOldId: Map<number, string>,
    maps: IdMaps,
    report?: ConditionRemapReport,
): Record<string, unknown> {
    const out = remapJson(remapIdConditions(config, fieldTypeByOldId, maps, report), maps) as Record<string, unknown>;
    const isUserField = (raw: unknown): boolean => {
        const id = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(id) && fieldTypeByOldId.get(id) === 'user';
    };
    const userKey = (key: unknown): string | null => {
        if (typeof key !== 'string') return null;
        if (key === '__null__') return key;
        const id = mapId(maps.user, key);
        return id === null ? null : String(id);
    };
    const keys = (raw: unknown): string[] | undefined =>
        Array.isArray(raw) ? raw.map(userKey).filter((k): k is string => k !== null) : undefined;
    const byColumn = (raw: unknown): unknown =>
        Array.isArray(raw)
            ? raw.flatMap((entry) => {
                  if (!entry || typeof entry !== 'object') return [];
                  const column = userKey((entry as { column?: unknown }).column);
                  return column === null ? [] : [{ ...(entry as Record<string, unknown>), column }];
              })
            : raw;
    if (isUserField(config.group_by_field_id)) {
        for (const k of ['kanban_collapsed_columns', 'kanban_hidden_columns'] as const) {
            if (out[k] !== undefined) out[k] = keys(out[k]);
        }
        for (const k of ['kanban_wip_limits', 'kanban_move_rules'] as const) {
            if (out[k] !== undefined) out[k] = byColumn(out[k]);
        }
    }
    if (isUserField(config.kanban_lane_field_id) && out.kanban_collapsed_lanes !== undefined) {
        out.kanban_collapsed_lanes = keys(out.kanban_collapsed_lanes);
    }
    // C1 — kanban agrupado por EQUIPO: las claves son el conjunto de ids (`[3, 7]`).
    const isTeamField = (raw: unknown): boolean => {
        const id = typeof raw === 'number' ? raw : Number(raw);
        return Number.isFinite(id) && fieldTypeByOldId.get(id) === 'team';
    };
    const teamKey = (key: unknown): string | null => {
        if (typeof key !== 'string') return null;
        if (key === '__null__') return key;
        try {
            const parsed: unknown = JSON.parse(key);
            const ids = (Array.isArray(parsed) ? parsed : [parsed]).map((v) => mapId(maps.team, v));
            if (ids.some((v) => v === null)) return null;
            return `[${(ids as number[]).sort((a, b) => a - b).join(', ')}]`;
        } catch {
            return null;
        }
    };
    const teamKeys = (raw: unknown): string[] | undefined =>
        Array.isArray(raw) ? raw.map(teamKey).filter((k): k is string => k !== null) : undefined;
    const teamByColumn = (raw: unknown): unknown =>
        Array.isArray(raw)
            ? raw.flatMap((entry) => {
                  if (!entry || typeof entry !== 'object') return [];
                  const column = teamKey((entry as { column?: unknown }).column);
                  return column === null ? [] : [{ ...(entry as Record<string, unknown>), column }];
              })
            : raw;
    if (isTeamField(config.group_by_field_id)) {
        for (const k of ['kanban_collapsed_columns', 'kanban_hidden_columns'] as const) {
            if (out[k] !== undefined) out[k] = teamKeys(out[k]);
        }
        for (const k of ['kanban_wip_limits', 'kanban_move_rules'] as const) {
            if (out[k] !== undefined) out[k] = teamByColumn(out[k]);
        }
    }
    if (isTeamField(config.kanban_lane_field_id) && out.kanban_collapsed_lanes !== undefined) {
        out.kanban_collapsed_lanes = teamKeys(out.kanban_collapsed_lanes);
    }
    // B1 — Gantt agrupado por PERSONA: los grupos plegados son ids de usuario.
    if (isUserField(config.gantt_group_by_field_id) && out.collapsed_groups !== undefined) {
        out.collapsed_groups = keys(out.collapsed_groups);
    }
    // B2 — Carga de trabajo: las personas visibles son ids de usuario (la
    // clave no sigue ninguna convención). Una que no viajó se descarta.
    if (Array.isArray(out.workload_user_ids)) {
        out.workload_user_ids = out.workload_user_ids.map((v) => mapId(maps.user, v)).filter((v): v is number => v !== null);
    }
    // C1 — el filtro por equipo de la carga: un equipo que no viajó se quita
    // (la vista vuelve a mostrar a todos, no a nadie).
    if (out.workload_team_id !== undefined && out.workload_team_id !== null) {
        const t = mapId(maps.team, out.workload_team_id);
        if (t === null) delete out.workload_team_id;
        else out.workload_team_id = t;
    }
    return out;
}

/**
 * Las condiciones y merge tags de una automatización hablan por SLUG, así que
 * sus CAMPOS sobreviven solos; lo que sí hay que traducir son los ids de
 * `actions[]` (campo, lista destino, conexión) y del trigger, recorriendo las
 * ramas del `if_else`. `remapJson` ya cubre las claves por convención más
 * `connection_id`, que no sigue ninguna.
 *
 * Con `conditions` (la lista vieja de la automatización y el índice de
 * campos), también el VALOR de las condiciones sobre un campo Persona o Equipo
 * — en el disparador, en cada paso y en todas sus ramas — y la lista destino
 * de «Crear un registro» (`target_list`, que no sigue la convención).
 */
export function remapAutomation(
    triggerConfig: Record<string, unknown>,
    actions: unknown,
    maps: IdMaps,
    conditions?: AutomationConditionContext,
): { triggerConfig: Record<string, unknown>; actions: unknown } {
    const pre = conditions ? remapAutomationConditions(triggerConfig, actions, maps, conditions) : { triggerConfig, actions };
    const trigger = remapJson(pre.triggerConfig, maps) as Record<string, unknown>;
    // El token del webhook entrante se re-emite en el destino: la URL vieja
    // apunta a la instancia de origen.
    delete trigger.webhook_token;
    return { triggerConfig: trigger, actions: fixSignatureTemplates(pre.actions, remapJson(pre.actions, maps), maps) };
}

/**
 * v0.1.448 — En «Pedir firma de un documento» (`request_signature`) la clave
 * `template_id` es una plantilla de DOCUMENTO, no de registro (que es lo que
 * significa en «Crear un registro»): se traduce con su mapa, también dentro de
 * las ramas «Si / sino» y «Repetir por cada vinculado». Se recorren a la par el
 * original y el ya re-mapeado (misma forma).
 */
function fixSignatureTemplates(original: unknown, remapped: unknown, maps: IdMaps): unknown {
    if (Array.isArray(original) && Array.isArray(remapped)) {
        return remapped.map((v, i) => fixSignatureTemplates(original[i], v, maps));
    }
    if (!original || typeof original !== 'object' || !remapped || typeof remapped !== 'object' || Array.isArray(remapped)) return remapped;
    const o = original as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(remapped as Record<string, unknown>)) out[k] = fixSignatureTemplates(o[k], v, maps);
    if (o.type === 'request_signature' && o.config && typeof o.config === 'object' && out.config && typeof out.config === 'object') {
        const raw = (o.config as Record<string, unknown>).template_id;
        out.config = { ...(out.config as Record<string, unknown>), template_id: raw === null || raw === undefined ? null : mapId(maps.document, raw) };
    }
    return out;
}

/**
 * v0.1.206 — ajustes de una sincronización con tienda (`connection_syncs.settings`).
 * No siguen la convención de claves (`lists.customers`, `fields.orders.total`,
 * `meta_map.products[clave]`), así que se traducen a mano. Lo que no resuelve
 * se DESCARTA: un id viejo apuntaría a una lista o un campo de otra empresa.
 */
export function remapSyncSettings(
    raw: unknown,
    maps: IdMaps,
    groupMap: Map<number, number>,
): Record<string, unknown> {
    const s = raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
    const remapIds = (value: unknown, map: Map<number, number>): Record<string, number> => {
        const out: Record<string, number> = {};
        if (!value || typeof value !== 'object') return out;
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            const id = mapId(map, v);
            if (id !== null) out[k] = id;
        }
        return out;
    };
    const nested = (value: unknown, map: Map<number, number>): Record<string, Record<string, number>> => {
        const out: Record<string, Record<string, number>> = {};
        if (!value || typeof value !== 'object') return out;
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = remapIds(v, map);
        return out;
    };
    s.lists = remapIds(s.lists, maps.list);
    s.fields = nested(s.fields, maps.field);
    s.meta_map = nested(s.meta_map, maps.field);
    s.folder_id = mapId(groupMap, s.folder_id);
    // Los tableros se importan sin mapa de ids: el enlace se pierde (el tablero no).
    s.dashboard_id = null;
    return s;
}

/**
 * Campo «Botón» — su config apunta a campos (por convención), a una plantilla
 * de documento (`document_template_id`) y a una automatización
 * (`automation_id`, que no está en `IdMaps`: se pasa aparte porque las
 * automatizaciones se insertan DESPUÉS de los campos). Lo que no resuelve se
 * quita: el botón queda incompleto en vez de apuntar a la fila de otra empresa.
 */
export function remapButtonConfig(config: Record<string, unknown>, maps: IdMaps, automations: Map<number, number>): Record<string, unknown> {
    const out = remapJson(config, maps) as Record<string, unknown>;
    const original = Array.isArray(config.actions) ? (config.actions as Array<Record<string, unknown>>) : [];
    if (Array.isArray(out.actions)) {
        out.actions = (out.actions as Array<Record<string, unknown>>).map((a, i) => {
            if (a.type !== 'run_automation') return a;
            const raw = original[i]?.automation_id;
            return { ...a, automation_id: raw === undefined || raw === null ? null : mapId(automations, raw) };
        });
    }
    return cleanResolvedButtonConfig(out);
}

/**
 * D3 — WhatsApp oficial: `connections.config.whatsapp.inbound_list_id` (la
 * lista donde caen los mensajes) no sigue la convención de `remapJson` en el
 * resto de la conexión (que viaja tal cual). Una lista que no viajó deja la
 * conexión sin lista de entrada en vez de apuntar a la de otra empresa.
 */
export function remapWhatsappConnectionConfig(provider: string, config: Record<string, unknown>, maps: IdMaps): Record<string, unknown> {
    if (provider === 'mercadopago') return remapSubscriptionImportConfig(config, maps);
    if (provider !== 'whatsapp_cloud' && provider !== 'whatsapp_web') return config;
    // v0.1.389 — Imagina WAS: el aviso registrado es del servidor de origen
    // (su URL y su secreto). Se suelta: el servidor nuevo registra el suyo al
    // abrir la conexión, sin borrar el del origen (migrar es copiar).
    const base = provider === 'whatsapp_web' ? Object.fromEntries(Object.entries(config).filter(([k]) => k !== 'whatsapp_web')) : config;
    const wa = base.whatsapp;
    if (wa === null || typeof wa !== 'object' || Array.isArray(wa)) return base;
    const w = wa as Record<string, unknown>;
    return { ...base, whatsapp: { ...w, inbound_list_id: w.inbound_list_id === null || w.inbound_list_id === undefined ? null : mapId(maps.list, w.inbound_list_id) } };
}

/**
 * v0.1.376 — Mercado Pago: lo que trae las suscripciones nuevas solas
 * (`config.subscription_import`) apunta a una lista y a su columna de correo.
 * Una lista que no viajó deja la importación sin destino (y sin traer nada).
 */
export function remapSubscriptionImportConfig(config: Record<string, unknown>, maps: IdMaps): Record<string, unknown> {
    const imp = config.subscription_import;
    if (imp === null || typeof imp !== 'object' || Array.isArray(imp)) return config;
    const i = imp as Record<string, unknown>;
    const listId = i.list_id === null || i.list_id === undefined ? null : mapId(maps.list, i.list_id);
    const emailId = i.email_field_id === null || i.email_field_id === undefined ? null : mapId(maps.field, i.email_field_id);
    return { ...config, subscription_import: { ...i, list_id: listId, email_field_id: emailId, auto: listId === null ? false : i.auto } };
}

/**
 * v0.1.351 — Los archivos que la EMPRESA referencia en su `settings`: el logo
 * de la marca y las imágenes de sus temas guardados («Mis temas»). Antes de
 * esta versión el logo viajaba con el id del servidor de origen y quedaba
 * roto (o apuntando a otro archivo) en el destino.
 */
export function remapTenantSettingsFiles(settings: Record<string, unknown>, maps: IdMaps): Record<string, unknown> {
    const out = { ...settings };
    const branding = out.branding;
    if (branding !== null && typeof branding === 'object' && !Array.isArray(branding)) {
        const b = { ...(branding as Record<string, unknown>) };
        if (b.logo_file_id !== null && b.logo_file_id !== undefined) b.logo_file_id = mapId(maps.attachment, b.logo_file_id);
        out.branding = b;
    }
    if (Array.isArray(out.public_themes)) out.public_themes = remapJson(out.public_themes, maps);
    return out;
}
