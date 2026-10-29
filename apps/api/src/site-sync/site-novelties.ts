import { SITE_COLUMN_SOURCES, siteResourceKey, type SiteColumnSource, type SiteDiscovery, type SiteNovelties, type SiteNovelty } from '@imagina-base/shared';
import type { SiteSyncSettings } from './site-sync.types';

/**
 * v0.1.336 — Novedades del sitio: tipos de contenido y columnas que
 * aparecieron en WordPress desde la última vez que se miró.
 *
 * Se compara contra lo que el sitio OFRECÍA la última vez (`seen`), no contra
 * lo que se trae: una columna que la persona eligió no traer al conectar no
 * vuelve a aparecer como novedad. La primera vez que se mira un sitio (o un
 * tipo de contenido recién sumado) no hay con qué comparar: lo de hoy pasa a
 * ser la base, sin novedades. Las columnas internas de los plugins (empiezan
 * con `_`) nunca cuentan: un plugin las crea por decenas.
 *
 * Todo PURO: lo prueban los tests sin un sitio.
 */

/** Lo que el sitio ofrecía la última vez: recursos y, por recurso sincronizado, sus columnas. */
export interface SiteSeen {
    objects: string[];
    columns: Record<string, string[]>;
}

/** Tope de novedades guardadas (un plugin nuevo puede sumar decenas de campos). */
export const MAX_NOVELTIES = 60;

function obj(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function strings(v: unknown): string[] {
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export function readSeen(state: unknown): SiteSeen | null {
    const raw = obj(state).seen;
    if (!raw || typeof raw !== 'object') return null;
    const s = obj(raw);
    const columns: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(obj(s.columns))) columns[k] = strings(v);
    return { objects: strings(s.objects), columns };
}

export function readNovelties(state: unknown): SiteNovelties | null {
    const raw = obj(obj(state).novelties);
    if (Object.keys(raw).length === 0) return null;
    const items = (Array.isArray(raw.items) ? raw.items : [])
        .map((i) => obj(i))
        .filter((i) => typeof i.resource === 'string' && typeof i.object === 'string')
        .map((i): SiteNovelty => {
            const c = obj(i.column);
            return {
                resource: String(i.resource),
                kind: i.kind === 'taxonomy' || i.kind === 'media' ? i.kind : 'post_type',
                object: String(i.object),
                object_label: typeof i.object_label === 'string' ? i.object_label : String(i.object),
                column:
                    typeof c.key === 'string'
                        ? {
                              key: c.key,
                              label: typeof c.label === 'string' ? c.label : c.key,
                              source: (SITE_COLUMN_SOURCES as readonly string[]).includes(String(c.source)) ? (c.source as SiteColumnSource) : 'meta',
                              provider: typeof c.provider === 'string' ? c.provider : null,
                          }
                        : null,
            };
        });
    return {
        checked_at: typeof raw.checked_at === 'string' ? raw.checked_at : null,
        items,
        error: typeof raw.error === 'string' && raw.error !== '' ? raw.error : null,
    };
}

/** Las columnas que se ofrecen de un tipo de contenido (sin las internas). */
function offeredColumns(o: SiteDiscovery['objects'][number]): Array<SiteDiscovery['objects'][number]['columns'][number]> {
    return o.columns.filter((c) => !c.private);
}

/**
 * Novedades de hoy contra la base, y la base actualizada (lo recién sumado
 * entra a la base sin contar como novedad). `dismissed` = lo que la persona ya
 * vio y no quiere que se le vuelva a mostrar.
 */
export function computeNovelties(
    discovery: Pick<SiteDiscovery, 'objects'>,
    seen: SiteSeen | null,
    settings: Pick<SiteSyncSettings, 'objects'>,
): { items: SiteNovelty[]; seen: SiteSeen } {
    const next: SiteSeen = seen ? { objects: [...seen.objects], columns: { ...seen.columns } } : { objects: [], columns: {} };
    const items: SiteNovelty[] = [];
    for (const o of discovery.objects) {
        const resource = siteResourceKey(o.kind, o.object);
        const synced = settings.objects[resource];
        const offered = offeredColumns(o);
        if (!synced) {
            if (seen && !seen.objects.includes(resource)) {
                items.push({ resource, kind: o.kind, object: o.object, object_label: o.label, column: null });
            }
            if (!seen) next.objects.push(resource);
            continue;
        }
        if (!next.objects.includes(resource)) next.objects.push(resource);
        const base = seen?.columns[resource];
        if (!base) {
            // Primera vez que se mira este tipo de contenido: lo de hoy es la base.
            next.columns[resource] = offered.map((c) => c.key);
            continue;
        }
        const have = new Set(synced.columns.map((c) => c.key));
        for (const c of offered) {
            if (have.has(c.key) || base.includes(c.key)) continue;
            items.push({
                resource,
                kind: o.kind,
                object: o.object,
                object_label: o.label,
                column: { key: c.key, label: c.label, source: c.source, provider: c.provider },
            });
        }
    }
    return { items: items.slice(0, MAX_NOVELTIES), seen: next };
}

/** «Ya lo vi»: lo indicado (o todo) pasa a la base y deja de ser novedad. */
export function dismissNovelties(
    items: SiteNovelty[],
    seen: SiteSeen | null,
    which: Array<{ resource: string; key: string | null }> | undefined,
): { items: SiteNovelty[]; seen: SiteSeen } {
    const next: SiteSeen = seen ? { objects: [...seen.objects], columns: { ...seen.columns } } : { objects: [], columns: {} };
    const hit = (n: SiteNovelty) =>
        !which || which.some((w) => w.resource === n.resource && (w.key ?? null) === (n.column?.key ?? null));
    const keep: SiteNovelty[] = [];
    for (const n of items) {
        if (!hit(n)) {
            keep.push(n);
            continue;
        }
        if (n.column === null) {
            if (!next.objects.includes(n.resource)) next.objects.push(n.resource);
        } else {
            next.columns[n.resource] = [...new Set([...(next.columns[n.resource] ?? []), n.column.key])];
        }
    }
    return { items: keep, seen: next };
}

/**
 * Lo guardado, sin lo que ya se trae (la persona sumó la columna o el tipo de
 * contenido después de la última revisión): no tiene sentido seguir
 * mostrándolo como novedad.
 */
export function pendingNovelties(items: SiteNovelty[], settings: Pick<SiteSyncSettings, 'objects'>): SiteNovelty[] {
    return items.filter((n) => {
        const synced = settings.objects[n.resource];
        if (n.column === null) return !synced;
        return !!synced && !synced.columns.some((c) => c.key === n.column!.key);
    });
}
