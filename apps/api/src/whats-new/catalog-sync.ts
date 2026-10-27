import {
    compareVersions,
    whatsNewCatalogEntrySchema,
    type WhatsNewAction,
    type WhatsNewCatalogEntry,
    type WhatsNewKind,
} from '@imagina-base/shared';

/**
 * Cuántas novedades se anuncian como «nuevas» cuando llegan a un servidor:
 *  - la PRIMERA vez que esta función llega a un servidor que ya existía, las
 *    6 más recientes (lo de las últimas versiones grandes, no todo el
 *    historial);
 *  - en cada actualización, hasta 8: un servidor que estuvo meses sin
 *    actualizarse no le tira a nadie decenas de novedades de golpe.
 * El resto entra como historial (se ve en «Novedades», pero no suma al «sin
 * ver» ni sale en el diálogo de destacadas).
 */
export const FIRST_ARRIVAL_NEW = 6;
export const MAX_NEW_PER_SYNC = 8;

/** Lo que copia la sincronización de una entrada del catálogo. */
export interface ReleaseContent {
    kind: WhatsNewKind;
    title: string;
    summary: string;
    body: string;
    imageUrl: string | null;
    videoUrl: string | null;
    action: WhatsNewAction | null;
    version: string;
    featured: boolean;
    audienceRoles: string[];
    audiencePlans: string[];
    publishedAt: Date;
    expiresAt: Date | null;
}

export interface ParsedCatalogEntry extends ReleaseContent {
    key: string;
    /** Posición en el catálogo (lo de más abajo es más nuevo a igual versión). */
    index: number;
}

export interface ExistingRelease {
    id: number;
    key: string;
    edited: boolean;
    content: ReleaseContent;
}

export interface CatalogSyncPlan {
    inserts: Array<ReleaseContent & { key: string; announceFrom: Date | null }>;
    updates: Array<{ id: number; key: string; content: ReleaseContent }>;
    announced: string[];
}

/**
 * Mediodía UTC del día de la versión (así el día no cambia en ninguna zona
 * horaria de América ni de Europa), nunca en el futuro: si no, se escondería
 * hasta esa hora.
 */
function releaseDate(date: string, now: Date): Date {
    const [y, m, d] = date.split('-').map(Number) as [number, number, number];
    const at = new Date(Date.UTC(y, m - 1, d, 12));
    return at.getTime() > now.getTime() ? now : at;
}

/**
 * Valida y normaliza el catálogo. Una entrada inválida se descarta (con su
 * motivo) en vez de tumbar el arranque: el test del catálogo ya las frena
 * antes de publicar.
 */
export function parseCatalog(
    catalog: readonly WhatsNewCatalogEntry[],
    now: Date,
): { entries: ParsedCatalogEntry[]; invalid: Array<{ key: string; reason: string }> } {
    const entries: ParsedCatalogEntry[] = [];
    const invalid: Array<{ key: string; reason: string }> = [];
    const seen = new Set<string>();
    catalog.forEach((raw, index) => {
        const r = whatsNewCatalogEntrySchema.safeParse(raw);
        const key = typeof raw?.key === 'string' ? raw.key : `#${index}`;
        if (!r.success) {
            invalid.push({ key, reason: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
            return;
        }
        if (seen.has(r.data.key)) {
            invalid.push({ key, reason: 'clave repetida' });
            return;
        }
        seen.add(r.data.key);
        const e = r.data;
        entries.push({
            key: e.key,
            index,
            kind: e.kind,
            title: e.title,
            summary: e.summary,
            body: e.body ?? '',
            imageUrl: e.image_url ?? null,
            videoUrl: e.video_url ?? null,
            action: e.action ?? null,
            version: e.version,
            featured: e.featured ?? false,
            audienceRoles: [...(e.audience?.roles ?? [])],
            audiencePlans: [...(e.audience?.plans ?? [])],
            publishedAt: releaseDate(e.date, now),
            expiresAt: e.expires_at ? new Date(e.expires_at) : null,
        });
    });
    return { entries, invalid };
}

/**
 * Forma comparable del contenido (para no reescribir lo que no cambió). La
 * fecha de publicación NO entra: se fija al insertar (la de la versión) y no
 * se mueve en cada arranque.
 */
export function contentSignature(c: ReleaseContent): string {
    return JSON.stringify([
        c.kind,
        c.title,
        c.summary,
        c.body,
        c.imageUrl,
        c.videoUrl,
        c.action ? [c.action.label, c.action.href ?? null, c.action.tour ?? null] : null,
        c.version,
        c.featured,
        [...c.audienceRoles].sort(),
        [...c.audiencePlans].sort(),
        c.expiresAt ? c.expiresAt.toISOString() : null,
    ]);
}

/** Más nuevo primero: versión, después fecha, después posición en el catálogo. */
export function newestFirst(a: ParsedCatalogEntry, b: ParsedCatalogEntry): number {
    const byVersion = compareVersions(b.version, a.version);
    if (byVersion !== 0) return byVersion;
    const byDate = b.publishedAt.getTime() - a.publishedAt.getTime();
    if (byDate !== 0) return byDate;
    return b.index - a.index;
}

/**
 * Qué hacer con el catálogo frente a lo que ya hay en la tabla. PURO.
 *
 *  - Las claves que no están se INSERTAN. Las más recientes (hasta el tope)
 *    se anuncian desde AHORA: cuentan como nuevas para quien ya tenía cuenta
 *    cuando llegaron a este servidor, aunque la versión haya salido semanas
 *    antes. El resto entra como historial (`announceFrom = null`).
 *  - Las que están y el operador NO editó se actualizan si cambió el texto.
 *    Su estado (oculta/publicada), su fecha y su `announceFrom` no se tocan.
 *  - Las que el operador editó no se tocan.
 */
export function planCatalogSync(input: {
    existing: readonly ExistingRelease[];
    catalog: readonly ParsedCatalogEntry[];
    now: Date;
}): CatalogSyncPlan {
    const byKey = new Map(input.existing.map((e) => [e.key, e]));
    const firstArrival = input.existing.length === 0;
    const cap = firstArrival ? FIRST_ARRIVAL_NEW : MAX_NEW_PER_SYNC;

    const fresh = input.catalog.filter((e) => !byKey.has(e.key)).sort(newestFirst);
    const announcedKeys = new Set(fresh.slice(0, cap).map((e) => e.key));
    // Se insertan de la más vieja a la más nueva: así el id crece con la
    // novedad y desempata bien a igual fecha.
    const inserts = [...fresh].reverse().map((e) => {
        const { key, index: _index, ...content } = e;
        return { key, ...content, announceFrom: announcedKeys.has(key) ? input.now : null };
    });

    const updates: CatalogSyncPlan['updates'] = [];
    for (const e of input.catalog) {
        const row = byKey.get(e.key);
        if (!row || row.edited) continue;
        const { key, index: _index, ...content } = e;
        if (contentSignature(content) !== contentSignature(row.content)) updates.push({ id: row.id, key, content });
    }
    return { inserts, updates, announced: fresh.filter((e) => announcedKeys.has(e.key)).map((e) => e.key) };
}
