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
};
/** Arrays de ids con nombre propio que no son de listas. */
const EXPLICIT_ARRAYS: Record<string, keyof IdMaps> = {
    // v0.1.266 — PDFs adjuntos a un send_email.
    pdf_templates: 'document',
    // C5 — las personas que aprueban un paso de un flujo de aprobación.
    approver_user_ids: 'user',
};
/** Arrays de list ids con nombre propio. */
const LIST_ID_ARRAY_KEYS = new Set(['related_lists']);

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

/**
 * `lists.settings` mezcla tres vocabularios: ids por convención (los cubre
 * `remapJson`), SLUGS (que no se tocan porque viajan con el campo) y dos
 * lugares con forma propia: las CLAVES de `permissions.users` son ids de
 * usuario, y el token público es una credencial de la instancia vieja.
 */
export function remapListSettings(
    settings: Record<string, unknown>,
    maps: IdMaps,
    newPublicToken: string | null,
): Record<string, unknown> {
    const out = remapJson(settings, maps) as Record<string, unknown>;

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

    const pub = out.public;
    if (pub !== null && typeof pub === 'object') {
        // El token es la credencial del enlace público: se emite uno nuevo en
        // el destino (el viejo apunta a la instancia de origen).
        out.public = { ...(pub as Record<string, unknown>), token: newPublicToken ?? '' };
    }
    return out;
}

/**
 * v0.1.297 — Config de una vista guardada. Los ids de campo los cubre `remapJson`
 * por convención (`kanban_value_field_id`, `required_field_ids`…); lo que no
 * sigue ninguna son las CLAVES de columna y carril del kanban cuando el campo
 * es una PERSONA: la clave es su id de usuario como texto («30»). Se traducen
 * con el mapa de usuarios; una que no viajó se descarta (dejarla le aplicaría
 * el límite o el plegado a OTRA persona). `fieldTypeByOldId` es por el id
 * VIEJO del campo.
 */
export function remapViewConfig(
    config: Record<string, unknown>,
    fieldTypeByOldId: Map<number, string>,
    maps: IdMaps,
): Record<string, unknown> {
    const out = remapJson(config, maps) as Record<string, unknown>;
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
 * sobreviven solas; lo que sí hay que traducir son los ids de `actions[]`
 * (campo, lista destino, conexión) y del trigger, recorriendo las ramas del
 * `if_else`. `remapJson` ya cubre las claves por convención más
 * `connection_id`, que no sigue ninguna.
 */
export function remapAutomation(
    triggerConfig: Record<string, unknown>,
    actions: unknown,
    maps: IdMaps,
): { triggerConfig: Record<string, unknown>; actions: unknown } {
    const trigger = remapJson(triggerConfig, maps) as Record<string, unknown>;
    // El token del webhook entrante se re-emite en el destino: la URL vieja
    // apunta a la instancia de origen.
    delete trigger.webhook_token;
    return { triggerConfig: trigger, actions: remapJson(actions, maps) };
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
    if (provider !== 'whatsapp_cloud') return config;
    const wa = config.whatsapp;
    if (wa === null || typeof wa !== 'object' || Array.isArray(wa)) return config;
    const w = wa as Record<string, unknown>;
    return { ...config, whatsapp: { ...w, inbound_list_id: w.inbound_list_id === null || w.inbound_list_id === undefined ? null : mapId(maps.list, w.inbound_list_id) } };
}
