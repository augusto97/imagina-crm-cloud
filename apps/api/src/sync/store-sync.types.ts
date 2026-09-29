import {
    STORE_META_RESOURCES,
    STORE_SYNC_RESOURCES,
    type StoreMetaResource,
    type StoreSyncMode,
    type StoreSyncResource,
} from '@imagina-base/shared';

/**
 * Lo que guarda una sincronización (v0.1.206, ADR-S24). `settings` lo escribe
 * la persona (vía el service) y `state` el motor; los lectores de acá son
 * TOLERANTES —un jsonb viejo o a medio escribir nunca tira el motor—.
 */

export interface SyncSettings {
    resources: { customers: boolean; products: boolean; orders: boolean };
    orders_since: string | null;
    mode: StoreSyncMode;
    interval_minutes: number;
    write_back: boolean;
    store_url: string;
    store_name: string;
    /** Recurso → id de la lista que lo recibe. */
    lists: Partial<Record<StoreSyncResource, number>>;
    /** Recurso → (slug del pack → id del campo). Por ID: renombrar no rompe nada. */
    fields: Partial<Record<StoreSyncResource, Record<string, number>>>;
    /** Recurso → (clave de meta de la tienda → id del campo que la recibe). */
    meta_map: Partial<Record<StoreMetaResource, Record<string, number>>>;
    dashboard_id: number | null;
    folder_id: number | null;
}

export interface KeysetCursor {
    /** `date_modified_gmt` más alto ya procesado (UTC, sin zona, como la API). */
    at: string;
    /** Ids con exactamente ese `at` (la API compara por segundo). */
    ids: string[];
}

export interface MetaSeen {
    count: number;
    sample: string | null;
    type: string;
}

export interface SyncState {
    running: boolean;
    current: StoreSyncResource | null;
    progress: Partial<Record<StoreSyncResource, { done: number; total: number | null }>>;
    cursors: Partial<Record<'products' | 'orders', KeysetCursor | null>>;
    customers_full_at: string | null;
    variations_full_at: string | null;
    initial_done: boolean;
    last_run_at: string | null;
    last_success_at: string | null;
    last_error: string | null;
    warnings: string[];
    meta: Partial<Record<StoreMetaResource, Record<string, MetaSeen>>>;
    realtime: { received: number; last_received_at: string | null; error: string | null; webhook_ids: number[] };
    /** Fase 3: lo editado en la app que viajó (o no) a la tienda. */
    write_back: { pushed: number; failed: number; last_at: string | null; last_error: string | null };
}

function obj(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function idMap(v: unknown): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, raw] of Object.entries(obj(v))) {
        const n = Number(raw);
        if (Number.isInteger(n) && n > 0) out[k] = n;
    }
    return out;
}

function strOrNull(v: unknown): string | null {
    return typeof v === 'string' && v !== '' ? v : null;
}

export function readSettings(raw: unknown): SyncSettings {
    const s = obj(raw);
    const res = obj(s.resources);
    const lists: SyncSettings['lists'] = {};
    const listsRaw = idMap(s.lists);
    const fields: SyncSettings['fields'] = {};
    const fieldsRaw = obj(s.fields);
    for (const r of STORE_SYNC_RESOURCES) {
        if (listsRaw[r]) lists[r] = listsRaw[r];
        if (fieldsRaw[r]) fields[r] = idMap(fieldsRaw[r]);
    }
    const meta_map: SyncSettings['meta_map'] = {};
    const metaRaw = obj(s.meta_map);
    for (const r of STORE_META_RESOURCES) if (metaRaw[r]) meta_map[r] = idMap(metaRaw[r]);
    const interval = Number(s.interval_minutes);
    return {
        resources: {
            customers: res.customers !== false,
            products: res.products !== false,
            orders: res.orders !== false,
        },
        orders_since: strOrNull(s.orders_since),
        mode: s.mode === 'realtime' ? 'realtime' : 'interval',
        interval_minutes: Number.isInteger(interval) && interval > 0 ? interval : 15,
        write_back: s.write_back === true,
        store_url: typeof s.store_url === 'string' ? s.store_url : '',
        store_name: typeof s.store_name === 'string' ? s.store_name : '',
        lists,
        fields,
        meta_map,
        dashboard_id: Number(s.dashboard_id) > 0 ? Number(s.dashboard_id) : null,
        folder_id: Number(s.folder_id) > 0 ? Number(s.folder_id) : null,
    };
}

function readCursor(v: unknown): KeysetCursor | null {
    const c = obj(v);
    if (typeof c.at !== 'string' || c.at === '') return null;
    return { at: c.at, ids: Array.isArray(c.ids) ? c.ids.map(String).slice(0, 500) : [] };
}

export function readState(raw: unknown): SyncState {
    const s = obj(raw);
    const progress: SyncState['progress'] = {};
    for (const [k, v] of Object.entries(obj(s.progress))) {
        if (!(STORE_SYNC_RESOURCES as readonly string[]).includes(k)) continue;
        const p = obj(v);
        progress[k as StoreSyncResource] = {
            done: Number(p.done) || 0,
            total: Number.isFinite(Number(p.total)) && p.total !== null ? Number(p.total) : null,
        };
    }
    const cursors = obj(s.cursors);
    const meta: SyncState['meta'] = {};
    for (const r of STORE_META_RESOURCES) {
        const m = obj(obj(s.meta)[r]);
        const out: Record<string, MetaSeen> = {};
        for (const [key, v] of Object.entries(m)) {
            const e = obj(v);
            out[key] = { count: Number(e.count) || 0, sample: strOrNull(e.sample), type: String(e.type ?? 'text') };
        }
        if (Object.keys(out).length > 0) meta[r] = out;
    }
    const rt = obj(s.realtime);
    const wb = obj(s.write_back);
    return {
        running: s.running === true,
        current: (STORE_SYNC_RESOURCES as readonly string[]).includes(String(s.current))
            ? (s.current as StoreSyncResource)
            : null,
        progress,
        cursors: { products: readCursor(cursors.products), orders: readCursor(cursors.orders) },
        customers_full_at: strOrNull(s.customers_full_at),
        variations_full_at: strOrNull(s.variations_full_at),
        initial_done: s.initial_done === true,
        last_run_at: strOrNull(s.last_run_at),
        last_success_at: strOrNull(s.last_success_at),
        last_error: strOrNull(s.last_error),
        warnings: Array.isArray(s.warnings) ? s.warnings.map(String).slice(0, 20) : [],
        meta,
        realtime: {
            received: Number(rt.received) || 0,
            last_received_at: strOrNull(rt.last_received_at),
            error: strOrNull(rt.error),
            webhook_ids: Array.isArray(rt.webhook_ids)
                ? rt.webhook_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0)
                : [],
        },
        write_back: {
            pushed: Number(wb.pushed) || 0,
            failed: Number(wb.failed) || 0,
            last_at: strOrNull(wb.last_at),
            last_error: strOrNull(wb.last_error),
        },
    };
}

/** La lista de metadatos de una variación se guarda bajo `variations`; la del producto, `products`. */
export function metaResourceOf(resource: StoreSyncResource): StoreMetaResource | null {
    return (STORE_META_RESOURCES as readonly string[]).includes(resource) ? (resource as StoreMetaResource) : null;
}
