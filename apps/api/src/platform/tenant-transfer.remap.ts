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
};
/** Arrays de ids con nombre propio que no son de listas. */
const EXPLICIT_ARRAYS: Record<string, keyof IdMaps> = {
    // v0.1.266 — PDFs adjuntos a un send_email.
    pdf_templates: 'document',
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
