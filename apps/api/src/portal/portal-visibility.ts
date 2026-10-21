import { layoutBlocks, type RecordLayoutV3 } from '@imagina-base/shared';

/**
 * Qué campos del registro del cliente le llegan al portal: los que el DISEÑO
 * vigente muestra (bloques de campo, propiedades, etapas, archivos, textos y
 * botones que leen un campo, y la cabecera), más el título y los editables.
 *
 * Antes `GET /portal/me` mandaba el registro ENTERO (y la definición de todos
 * sus campos): una columna interna que el diseño no dibujaba —costo, margen,
 * notas del equipo— viajaba igual y se leía en las herramientas del
 * navegador. Lo que el diseño no muestra, no sale del servidor.
 *
 * Puro: se prueba sin base.
 */

/** Ids que nombra un objeto de config (`*_field_id`, `*_field_ids`), a cualquier profundidad. */
function collectFieldRefs(node: unknown, out: Set<number>, depth = 0): void {
    if (depth > 6 || node === null || typeof node !== 'object') return;
    if (Array.isArray(node)) {
        for (const item of node) collectFieldRefs(item, out, depth + 1);
        return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (/(^|_)field_id$/.test(key) && typeof value === 'number') out.add(value);
        else if (/(^|_)field_ids$/.test(key) && Array.isArray(value)) {
            for (const v of value) if (typeof v === 'number') out.add(v);
        } else if (value !== null && typeof value === 'object') collectFieldRefs(value, out, depth + 1);
    }
}

/**
 * Bloques cuyos `*_field_id` apuntan a OTRA lista (gráficos y tablas de lo
 * vinculado): sus campos no son del registro del cliente.
 */
const OTHER_LIST_BLOCKS = new Set(['chart', 'related']);

export function portalRecordFieldIds(
    layout: Pick<RecordLayoutV3, 'pages' | 'header'>,
    fields: ReadonlyArray<{ id: number; type: string }>,
    extra: { titleFieldId?: number | null; editableIds?: Iterable<number> } = {},
): Set<number> {
    const own = new Set(fields.map((f) => f.id));
    const refs = new Set<number>();
    const header = (layout.header ?? {}) as Record<string, unknown>;
    if (header.hidden !== true) collectFieldRefs(header, refs);
    for (const block of layoutBlocks(layout)) {
        if (OTHER_LIST_BLOCKS.has(block.type)) continue;
        collectFieldRefs(block.config, refs);
        // Un bloque de archivos sin campos elegidos muestra TODOS los de archivo.
        if (block.type === 'files') {
            const ids = (block.config as { field_ids?: unknown }).field_ids;
            if (!Array.isArray(ids) || ids.length === 0) {
                for (const f of fields) if (f.type === 'file') refs.add(f.id);
            }
        }
    }
    if (typeof extra.titleFieldId === 'number') refs.add(extra.titleFieldId);
    for (const id of extra.editableIds ?? []) refs.add(id);
    return new Set([...refs].filter((id) => own.has(id)));
}

/** ¿El diseño tiene conversación? (y si el cliente puede escribir en ella). */
export function portalConversation(layout: Pick<RecordLayoutV3, 'pages'>): { comments: boolean; writable: boolean; activity: boolean } {
    let comments = false;
    let writable = false;
    let activity = false;
    for (const b of layoutBlocks(layout)) {
        if (b.type === 'comments') {
            comments = true;
            if ((b.config as { readonly?: unknown }).readonly !== true) writable = true;
        }
        if (b.type === 'activity') activity = true;
    }
    return { comments, writable, activity };
}

/** Diff de actividad acotado a los campos que el cliente puede ver (`{fN: {from,to}}`). */
export function filterActivityDiff(diff: unknown, visible: ReadonlySet<number>): Record<string, unknown> {
    if (diff === null || typeof diff !== 'object' || Array.isArray(diff)) return {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(diff as Record<string, unknown>)) {
        const m = /^f(\d+)$/.exec(key);
        if (m && visible.has(Number(m[1]))) out[key] = value;
    }
    return out;
}
