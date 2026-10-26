import { buildMemberLookup, buildTeamLookup, foldSearchText, type Team, type TextCoercionOptions } from '@imagina-base/shared';

import type { WpUserSummary } from '@/hooks/useWpUsers';
import { relationTarget } from '@/hooks/useRelationTitles';
import { api } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { titleFieldOf } from '@/lib/recordTitle';
import { browserTimeZone, getTenantFormat } from '@/lib/tenantFormat';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import type { ClipCell, GridClip } from './clipboard';
import {
    addUnknown,
    cellWriteBlock,
    emptyValueFor,
    planNewRows,
    planPaste,
    sameCellValue,
    type CellChange,
    type CellIssue,
    type GridColumnRef,
    type GridPlan,
    type LockedReason,
    type NewRowPlan,
    type RelationTitleIndex,
} from './gridPlan';
import type { GridRect } from './selection';

/**
 * v0.1.294 — El flujo de PEGAR, separado del controlador de la tabla:
 *  1. `preparePaste`: lo que hay que saber ANTES de convertir el texto — las
 *     personas por nombre o correo y los registros vinculados por título (una
 *     búsqueda por texto distinto, con tope), y si lo pegado salió de la propia
 *     tabla (portapapeles interno: valores reales, y si fue un corte).
 *  2. `computePaste`: el plan (puro): qué celdas cambian, qué filas nuevas se
 *     pueden crear, qué no se puede y por qué, y qué celdas de origen se vacían
 *     si fue un CORTE.
 */
export interface PasteInputs {
    block: string[][];
    internal: ClipCell[][] | null;
    target: GridRect;
    coercion: TextCoercionOptions;
    relationIds: RelationTitleIndex;
    clip: GridClip | null;
}

export interface PasteOutcome {
    plan: GridPlan;
    newRows: NewRowPlan[];
    newRowIssues: CellIssue[];
    /** CORTAR y pegar: las celdas de origen que se vacían (las que no pisa el destino). */
    cutClears: CellChange[];
    cutIssues: CellIssue[];
}

const MAX_LOOKUPS = 30;

/** El bloque tiene la misma forma que lo que guardó la tabla al copiar. */
function alignedInternal(block: string[][], clip: GridClip | null): ClipCell[][] | null {
    if (!clip) return null;
    if (clip.cells.length !== block.length) return null;
    for (let i = 0; i < block.length; i++) {
        if ((clip.cells[i]?.length ?? 0) !== (block[i]?.length ?? 0)) return null;
    }
    return clip.cells;
}

/** Columnas de destino que toca el bloque (una celda llena todo el rango). */
function targetColumns(block: string[][], target: GridRect, columns: GridColumnRef[]): Array<{ dc: number; column: GridColumnRef }> {
    const width = Math.max(0, ...block.map((r) => r.length));
    const single = block.length === 1 && width === 1;
    const span = single ? target.right - target.left + 1 : width;
    const out: Array<{ dc: number; column: GridColumnRef }> = [];
    for (let dc = 0; dc < span; dc++) {
        const column = columns[target.left + dc];
        if (column) out.push({ dc: single ? 0 : dc, column });
    }
    return out;
}

export async function preparePaste(args: {
    text: string;
    block: string[][];
    target: GridRect;
    columns: GridColumnRef[];
    clip: GridClip | null;
}): Promise<PasteInputs> {
    const { block, target, columns } = args;
    const internal = alignedInternal(block, args.clip);
    const cols = targetColumns(block, target, columns);

    // Personas por nombre o correo (el id ya viene en el portapapeles interno).
    const userTexts = new Set<string>();
    // Registros vinculados por título, por campo relation.
    const relationTexts = new Map<number, { field: FieldEntity; texts: Set<string> }>();
    for (const { dc, column } of cols) {
        const f = column.field;
        if (!f || (f.type !== 'user' && f.type !== 'relation')) continue;
        block.forEach((line, dr) => {
            const cell = internal?.[dr]?.[dc];
            if (cell && cell.fieldId === f.id) return; // vuelve a su campo: valor real
            const t = (line[dc] ?? '').trim();
            if (t === '') return;
            if (f.type === 'user') {
                if (!/^\d+$/.test(t)) userTexts.add(t);
                return;
            }
            for (const token of t.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean)) {
                if (/^#\d+$/.test(token)) continue;
                const entry = relationTexts.get(f.id) ?? { field: f, texts: new Set<string>() };
                entry.texts.add(token);
                relationTexts.set(f.id, entry);
            }
        });
    }

    let members: Map<string, number> | undefined;
    if (userTexts.size > 0) {
        const found = new Map<number, { id: number; name: string; email: string }>();
        await Promise.all(
            [...userTexts].slice(0, MAX_LOOKUPS).map(async (q) => {
                try {
                    const res = await api.get<WpUserSummary[]>('/me/users-search', { query: { q, limit: 5 } });
                    for (const u of res.data) found.set(u.id, { id: u.id, name: u.display_name, email: u.login });
                } catch {
                    // Sin resultados: la celda queda como "persona no encontrada".
                }
            }),
        );
        members = buildMemberLookup([...found.values()]);
    }

    const relationIds = new Map<number, Map<string, number | null>>();
    for (const { field, texts } of relationTexts.values()) {
        const target = relationTarget(field);
        if (target === null) continue;
        const index = new Map<string, number | null>();
        relationIds.set(field.id, index);
        let titleSlug: string | null = null;
        try {
            const fields = await api.get<FieldEntity[]>(`/lists/${target}/fields`);
            titleSlug = titleFieldOf(fields.data)?.slug ?? null;
        } catch {
            titleSlug = null;
        }
        if (titleSlug === null) continue;
        await Promise.all(
            [...texts].slice(0, MAX_LOOKUPS).map(async (q) => {
                try {
                    const res = await api.get<RecordEntity[]>(`/lists/${target}/records`, { query: { per_page: 20, search: q } });
                    const want = foldSearchText(q);
                    const hits = res.data.filter((r) => {
                        const v = r.fields[titleSlug!];
                        return typeof v === 'string' && foldSearchText(v) === want;
                    });
                    if (hits.length === 1) index.set(want, hits[0]!.id);
                    else if (hits.length > 1) index.set(want, null);
                } catch {
                    // Sin resultados: «No se encontró».
                }
            }),
        );
    }

    // C1 — equipos por nombre (el portapapeles interno ya trae los ids).
    let teams: Map<string, number> | undefined;
    if (cols.some(({ column }) => column.field?.type === 'team')) {
        try {
            const res = await api.get<Team[]>('/teams');
            teams = buildTeamLookup((Array.isArray(res.data) ? res.data : []).map((t) => ({ id: t.id, name: t.name })));
        } catch {
            teams = undefined;
        }
    }

    const fmt = getTenantFormat();
    return {
        block,
        internal,
        target,
        clip: args.clip,
        relationIds,
        coercion: {
            members,
            teams,
            numberFormat: fmt.number_format,
            dateFormat: fmt.date_format,
            // Una fecha y hora se lee en el reloj de quien pega (el mismo en
            // que la tabla la muestra).
            timeZone: browserTimeZone() ?? undefined,
            strictBoolean: true,
        },
    };
}

export function computePaste(
    inputs: PasteInputs,
    ctx: {
        rows: RecordEntity[];
        columns: GridColumnRef[];
        allFields: FieldEntity[];
        listId: number;
        locked?: LockedReason;
    },
): PasteOutcome {
    const plan = planPaste({
        block: inputs.block,
        internal: inputs.internal,
        target: inputs.target,
        rows: ctx.rows,
        columns: ctx.columns,
        coercion: inputs.coercion,
        relationIds: inputs.relationIds,
        locked: ctx.locked,
    });
    const created = planNewRows({
        overflow: plan.overflow,
        columns: ctx.columns,
        allFields: ctx.allFields,
        coercion: inputs.coercion,
        relationIds: inputs.relationIds,
        rowsLoaded: ctx.rows.length,
    });
    // Las opciones que faltan en las filas NUEVAS también se ofrecen crear.
    for (const u of created.unknownOptions) addUnknown(plan, u.field, u.labels);

    // CORTAR: el origen se vacía al pegar (lo que no pisa el destino).
    const cutClears: CellChange[] = [];
    const cutIssues: CellIssue[] = [];
    const clip = inputs.clip;
    if (clip?.cut && clip.listId === ctx.listId) {
        const dest = new Set<string>();
        const width = Math.max(0, ...inputs.block.map((r) => r.length));
        const single = inputs.block.length === 1 && width === 1;
        const height = single ? inputs.target.bottom - inputs.target.top + 1 : inputs.block.length;
        const span = single ? inputs.target.right - inputs.target.left + 1 : width;
        for (let dr = 0; dr < height; dr++) {
            const rec = ctx.rows[inputs.target.top + dr];
            if (!rec) continue;
            for (let dc = 0; dc < span; dc++) {
                const f = ctx.columns[inputs.target.left + dc]?.field;
                if (f) dest.add(`${rec.id}:${f.id}`);
            }
        }
        const fieldById = new Map<number, FieldEntity>();
        for (const f of ctx.allFields) fieldById.set(f.id, f);
        for (const c of ctx.columns) if (c.field) fieldById.set(c.field.id, c.field);
        for (const line of clip.cells) {
            for (const cell of line) {
                if (cell.recordId === null || cell.fieldId === null) continue;
                if (dest.has(`${cell.recordId}:${cell.fieldId}`)) continue;
                const field = fieldById.get(cell.fieldId);
                if (!field) continue;
                const record = ctx.rows.find((r) => r.id === cell.recordId) ?? ({ id: cell.recordId, fields: {} } as RecordEntity);
                if (cellWriteBlock(field, record, 'clear', ctx.locked) !== null) continue;
                const after = emptyValueFor(field);
                if (sameCellValue(field, cell.value, after)) continue;
                if (field.is_required && field.type !== 'checkbox') {
                    cutIssues.push({
                        row: -1,
                        col: -1,
                        label: field.label,
                        reason: sprintf(__('«%s» es obligatorio: en el origen quedó el valor (se copió en vez de moverse)'), field.label),
                        recordId: cell.recordId,
                    });
                    continue;
                }
                cutClears.push({ recordId: cell.recordId, field, before: cell.value, after, row: -1, col: -1 });
            }
        }
    }
    return { plan, newRows: created.rows, newRowIssues: created.issues, cutClears, cutIssues };
}

/** ¿Hay algo que conviene mostrar ANTES de pegar? */
export function pasteNeedsReview(o: PasteOutcome): boolean {
    return (
        o.plan.issues.length > 0
        || o.plan.overflow.length > 0
        || o.plan.unknownOptions.length > 0
        || o.newRowIssues.length > 0
        || o.cutIssues.length > 0
    );
}
