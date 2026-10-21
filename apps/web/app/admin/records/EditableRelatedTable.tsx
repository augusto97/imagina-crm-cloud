import { useMemo, useRef, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import type { StoreListMarker } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useCreateRecord, useDeleteRecord } from '@/hooks/useRecords';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCanAny } from '@/lib/permissions';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { EditableCell, RecordUpdaterProvider } from './EditableCell';
import { RecordCreateDialog } from './RecordCreateDialog';
import { renderCellValue } from './renderCellValue';
import { storeAccessFor } from './storeRules';

/** Tipos que la fila de totales sabe sumar (los mismos que el servidor). */
export const SUMMABLE_TYPES: ReadonlySet<string> = new Set(['number', 'currency', 'percent', 'duration', 'rating', 'computed', 'rollup']);
/** Tipos que no se editan en línea (se calculan o necesitan su propio editor). */
const DERIVED: ReadonlySet<string> = new Set(['computed', 'lookup', 'rollup', 'ai']);

export interface EditableRow {
    id: number;
    /** El valor de un campo en esta fila (las filas vienen del bundle o de la lista). */
    value: (field: FieldEntity) => unknown;
}

export interface EditableRelatedTableProps {
    /** La lista de los ítems (la del otro lado de la relación). */
    listId: number;
    listName: string;
    /** Todos los campos de esa lista (el alta completa los necesita). */
    fields: FieldEntity[];
    /** Las columnas, en orden (la primera suele ser el título). */
    columns: FieldEntity[];
    /** Cuáles se editan (vacío/undefined = todas las editables). */
    editableIds?: readonly number[];
    /** Cuáles se suman en la fila de totales. */
    totalIds: readonly number[];
    rows: EditableRow[];
    /** Cuántos vinculados hay en total (puede ser más que las filas). */
    total: number;
    /** Sumas calculadas por el servidor sobre TODO lo vinculado (si no, se suman las filas). */
    totals?: Record<string, number | null>;
    /** La relación por la que un ítem nuevo nace vinculado (null = no se puede agregar). */
    relation: { field: FieldEntity; recordId: number } | null;
    /** Lista de una tienda (la tienda manda: no se crean ni borran ítems aquí). */
    storeMarker?: StoreListMarker | null;
    /** Después de guardar una celda (parchear/refrescar lo que dependa). */
    onSaved?: (id: number, values: Record<string, unknown>) => void;
    /** Después de agregar o borrar un ítem. */
    onChanged?: () => void;
    /** Sólo mirar (el portal del cliente, la vista previa del editor). */
    readOnly?: boolean;
}

/**
 * v0.1.292 — Los registros VINCULADOS como TABLA EDITABLE (los ítems de una
 * cotización): cambiar cantidades y precios sin salir de la ficha, «Agregar
 * ítem» que nace vinculado, borrar con la confirmación de la app y una fila
 * de totales con el formato de cada campo. La usan el bloque «Vinculados» de
 * la ficha diseñada (vista «Tabla editable») y el panel de vinculados de la
 * ficha clásica. Cada celda es la `EditableCell` de las tablas de siempre: el
 * guardado, la validación del servidor y el ACL son los mismos.
 *
 * En el celular la tabla scrollea en horizontal dentro de su caja y las
 * celdas tienen alto de toque.
 */
export function EditableRelatedTable(p: EditableRelatedTableProps): JSX.Element {
    // Sólo mirar no necesita permisos, confirmaciones ni mutaciones (el portal
    // del cliente no tiene esos proveedores).
    return p.readOnly ? <ReadOnlyItemsTable {...p} /> : <EditableItemsTable {...p} />;
}

/**
 * La suma de cada columna elegida: la del servidor (sobre TODO lo vinculado)
 * o la de las filas, sólo si llegaron todas (sumar una página mostraría un
 * total equivocado: en ese caso queda `null`, «—»).
 */
export function computeColumnSums(
    p: Pick<EditableRelatedTableProps, 'totalIds' | 'columns' | 'totals' | 'rows' | 'total'>,
): Map<number, number | null> {
    const out = new Map<number, number | null>();
    for (const id of p.totalIds) {
        const f = p.columns.find((c) => c.id === id);
        if (!f || !SUMMABLE_TYPES.has(f.type)) continue;
        const server = p.totals?.[String(id)];
        if (server !== undefined) {
            out.set(id, server);
            continue;
        }
        if (p.rows.length < p.total) {
            out.set(id, null);
            continue;
        }
        let sum = 0;
        let any = false;
        for (const r of p.rows) {
            const v = r.value(f);
            const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
            if (Number.isFinite(n)) {
                sum += n;
                any = true;
            }
        }
        out.set(id, any ? sum : p.rows.length === 0 ? 0 : null);
    }
    return out;
}

function useColumnSums(p: EditableRelatedTableProps): Map<number, number | null> {
    const { totalIds, columns, totals, rows, total } = p;
    return useMemo(() => computeColumnSums({ totalIds, columns, totals, rows, total }), [totalIds, columns, totals, rows, total]);
}

function TotalsRow({ columns, sums, extraCell }: { columns: FieldEntity[]; sums: Map<number, number | null>; extraCell: boolean }): JSX.Element {
    return (
        <tfoot>
            <tr className="imcrm-border-t-2 imcrm-border-border imcrm-bg-muted/40 imcrm-font-semibold" data-editable-totals>
                {columns.map((c, i) => {
                    const sum = sums.get(c.id);
                    return (
                        <td
                            key={c.id}
                            className={cn('imcrm-whitespace-nowrap imcrm-px-3 imcrm-py-2', sums.has(c.id) && 'imcrm-text-right imcrm-tabular-nums')}
                            data-editable-total={sums.has(c.id) ? c.slug : undefined}
                        >
                            {sums.has(c.id) ? (sum === null || sum === undefined ? '—' : renderCellValue(c, sum)) : i === 0 ? __('Total') : null}
                        </td>
                    );
                })}
                {extraCell && <td />}
            </tr>
        </tfoot>
    );
}

function ShowingNote({ p }: { p: EditableRelatedTableProps }): JSX.Element | null {
    if (p.total <= p.rows.length) return null;
    return (
        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
            {p.totals
                ? sprintf(__('Mostrando %1$s de %2$s (los totales suman todo)'), formatNumber(p.rows.length), formatNumber(p.total))
                : sprintf(__('Mostrando %1$s de %2$s'), formatNumber(p.rows.length), formatNumber(p.total))}
        </span>
    );
}

/** La misma tabla, de sólo lectura: el cliente ve sus ítems y los totales. */
function ReadOnlyItemsTable(p: EditableRelatedTableProps): JSX.Element {
    const sums = useColumnSums(p);
    return (
        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col" data-testid="editable-related" data-readonly>
            <div className="imcrm-overflow-x-auto imcrm-overscroll-x-contain imcrm-border-t imcrm-border-border">
                <table className="imcrm-w-full imcrm-min-w-max imcrm-border-collapse imcrm-text-[13px]">
                    <thead>
                        <tr className="imcrm-text-left imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                            {p.columns.map((c) => (
                                <th key={c.id} className={cn('imcrm-whitespace-nowrap imcrm-px-3 imcrm-py-2 imcrm-font-medium', SUMMABLE_TYPES.has(c.type) && 'imcrm-text-right')}>
                                    {c.label}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {p.rows.map((r) => (
                            <tr key={r.id} className="imcrm-border-t imcrm-border-border/70" data-editable-row={r.id}>
                                {p.columns.map((c) => (
                                    <td
                                        key={c.id}
                                        className={cn('imcrm-max-w-[280px] imcrm-truncate imcrm-whitespace-nowrap imcrm-px-3 imcrm-py-2', SUMMABLE_TYPES.has(c.type) && 'imcrm-text-right imcrm-tabular-nums')}
                                        data-editable-cell={c.slug}
                                    >
                                        {renderCellValue(c, r.value(c))}
                                    </td>
                                ))}
                            </tr>
                        ))}
                        {p.rows.length === 0 && (
                            <tr>
                                <td colSpan={p.columns.length} className="imcrm-px-3 imcrm-py-4 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                                    {sprintf(__('Todavía no hay ítems de «%s».'), p.listName)}
                                </td>
                            </tr>
                        )}
                    </tbody>
                    {sums.size > 0 && <TotalsRow columns={p.columns} sums={sums} extraCell={false} />}
                </table>
            </div>
            {p.total > p.rows.length && (
                <div className="imcrm-px-3 imcrm-py-2">
                    <ShowingNote p={p} />
                </div>
            )}
        </div>
    );
}

function EditableItemsTable(p: EditableRelatedTableProps): JSX.Element {
    const canEditCaps = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    const canCreate = useCanAny(CAP.CREATE_RECORDS) && !p.storeMarker;
    const canDelete = useCanAny(CAP.DELETE_RECORDS, CAP.DELETE_OWN_RECORDS) && !p.storeMarker;
    const create = useCreateRecord(p.listId);
    const remove = useDeleteRecord(p.listId);
    const confirm = useConfirm();
    const toast = useToast();
    const [adding, setAdding] = useState(false);
    const [draft, setDraft] = useState('');
    const [addError, setAddError] = useState<string | null>(null);
    const [fullForm, setFullForm] = useState(false);
    const [deleting, setDeleting] = useState<number | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const titleField = p.columns.find((f) => f.is_primary) ?? p.fields.find((f) => f.is_primary) ?? p.columns[0];
    const titleTypable = titleField !== undefined && (titleField.type === 'text' || titleField.type === 'long_text');
    const editable = (f: FieldEntity): boolean =>
        canEditCaps && !DERIVED.has(f.type) && (p.editableIds === undefined || p.editableIds.length === 0 || p.editableIds.includes(f.id));
    const storeRules = useMemo(() => (p.storeMarker ? { marker: p.storeMarker, fields: p.fields } : null), [p.storeMarker, p.fields]);

    const sums = useColumnSums(p);
    const showTotals = sums.size > 0;

    const startAdding = (): void => {
        setAddError(null);
        setDraft('');
        setAdding(true);
        window.setTimeout(() => inputRef.current?.focus(), 0);
    };

    const addItem = async (): Promise<void> => {
        if (!p.relation) return;
        setAddError(null);
        const values: Record<string, unknown> = { [p.relation.field.slug]: [p.relation.recordId] };
        if (titleTypable && titleField && draft.trim() !== '') values[titleField.slug] = draft.trim();
        try {
            await create.mutateAsync(values);
            setDraft('');
            p.onChanged?.();
            window.setTimeout(() => inputRef.current?.focus(), 0);
        } catch (err) {
            // Un campo obligatorio que la tabla no tiene: se completa en el formulario.
            const msg = err instanceof ApiError ? Object.values(err.errors)[0] ?? err.message : err instanceof Error ? err.message : String(err);
            setAddError(msg);
        }
    };

    const deleteItem = async (id: number, label: string): Promise<void> => {
        const ok = await confirm({
            title: __('¿Eliminar este ítem?'),
            description: sprintf(__('«%s» se elimina de «%s».'), label, p.listName),
            confirmLabel: __('Eliminar'),
            destructive: true,
        });
        if (!ok) return;
        setDeleting(id);
        try {
            await remove.mutateAsync({ id });
            p.onChanged?.();
        } catch (err) {
            toast.error(__('No se pudo eliminar'), err instanceof Error ? err.message : String(err));
        } finally {
            setDeleting(null);
        }
    };

    const titleOf = (r: EditableRow): string => {
        const v = titleField ? r.value(titleField) : null;
        return typeof v === 'string' && v.trim() !== '' ? v : `#${r.id}`;
    };
    const actionsCol = canDelete;

    return (
        <RecordUpdaterProvider listId={p.listId} onSaved={p.onSaved}>
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col" data-testid="editable-related">
                {/* Scroll horizontal PROPIO: en el celular la tabla no rompe la ficha. */}
                <div className="imcrm-overflow-x-auto imcrm-overscroll-x-contain imcrm-border-t imcrm-border-border">
                    <table className="imcrm-w-full imcrm-min-w-max imcrm-border-collapse imcrm-text-[13px]">
                        <thead>
                            <tr className="imcrm-text-left imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                                {p.columns.map((c) => (
                                    <th
                                        key={c.id}
                                        className={cn(
                                            'imcrm-whitespace-nowrap imcrm-px-3 imcrm-py-2 imcrm-font-medium',
                                            SUMMABLE_TYPES.has(c.type) && 'imcrm-text-right',
                                        )}
                                    >
                                        {c.label}
                                    </th>
                                ))}
                                {actionsCol && <th className="imcrm-w-10" aria-label={__('Acciones')} />}
                            </tr>
                        </thead>
                        <tbody>
                            {p.rows.map((r) => (
                                <tr key={r.id} className="imcrm-group imcrm-border-t imcrm-border-border/70" data-editable-row={r.id}>
                                    {p.columns.map((c) => {
                                        const value = r.value(c);
                                        const access = storeRules ? storeAccessFor(storeRules, c, { fields: Object.fromEntries(p.fields.map((f) => [f.slug, r.value(f)])) }) : null;
                                        return (
                                            <td
                                                key={c.id}
                                                className={cn('imcrm-min-w-[120px] imcrm-max-w-[280px] imcrm-px-1 imcrm-py-0.5 imcrm-align-middle', c.id === titleField?.id && 'imcrm-min-w-[180px]')}
                                                data-editable-cell={c.slug}
                                            >
                                                {editable(c) ? (
                                                    <div className="imcrm-min-h-9 [&>*]:imcrm-min-h-9">
                                                        <EditableCell
                                                            field={c}
                                                            recordId={r.id}
                                                            listId={p.listId}
                                                            value={value}
                                                            canEdit
                                                            lockedReason={access?.access === 'locked' ? access.reason : null}
                                                        />
                                                    </div>
                                                ) : (
                                                    <div className={cn('imcrm-flex imcrm-min-h-9 imcrm-items-center imcrm-px-2', SUMMABLE_TYPES.has(c.type) && 'imcrm-justify-end')}>
                                                        {renderCellValue(c, value)}
                                                    </div>
                                                )}
                                            </td>
                                        );
                                    })}
                                    {actionsCol && (
                                        <td className="imcrm-w-10 imcrm-px-1 imcrm-text-center">
                                            <button
                                                type="button"
                                                aria-label={sprintf(__('Eliminar «%s»'), titleOf(r))}
                                                title={__('Eliminar')}
                                                disabled={deleting !== null}
                                                onClick={() => void deleteItem(r.id, titleOf(r))}
                                                className="imcrm-inline-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground imcrm-opacity-100 hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive sm:imcrm-opacity-0 sm:group-hover:imcrm-opacity-100 sm:focus:imcrm-opacity-100"
                                                data-editable-delete
                                            >
                                                {deleting === r.id ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />}
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            ))}
                            {p.rows.length === 0 && (
                                <tr>
                                    <td colSpan={p.columns.length + (actionsCol ? 1 : 0)} className="imcrm-px-3 imcrm-py-4 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                                        {sprintf(__('Todavía no hay ítems de «%s».'), p.listName)}
                                    </td>
                                </tr>
                            )}
                            {adding && (
                                <tr className="imcrm-border-t imcrm-border-border/70 imcrm-bg-accent/30" data-editable-new>
                                    <td colSpan={p.columns.length + (actionsCol ? 1 : 0)} className="imcrm-px-2 imcrm-py-1.5">
                                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                                            {titleTypable && (
                                                <input
                                                    ref={inputRef}
                                                    value={draft}
                                                    onChange={(e) => setDraft(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            void addItem();
                                                        } else if (e.key === 'Escape') {
                                                            setAdding(false);
                                                        }
                                                    }}
                                                    placeholder={sprintf(__('%s del ítem nuevo…'), titleField?.label ?? __('Nombre'))}
                                                    aria-label={titleField?.label ?? __('Nombre')}
                                                    className="imcrm-h-9 imcrm-min-w-[200px] imcrm-flex-1 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2.5 imcrm-text-sm focus:imcrm-outline-none focus:imcrm-ring-2 focus:imcrm-ring-ring"
                                                    data-editable-new-input
                                                />
                                            )}
                                            <Button size="sm" className="imcrm-h-9 imcrm-gap-1.5" onClick={() => void addItem()} disabled={create.isPending} data-editable-new-save>
                                                {create.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Plus className="imcrm-h-3.5 imcrm-w-3.5" />}
                                                {__('Agregar')}
                                            </Button>
                                            <Button size="sm" variant="ghost" className="imcrm-h-9" onClick={() => setAdding(false)}>
                                                {__('Listo')}
                                            </Button>
                                        </div>
                                        {addError && (
                                            <p className="imcrm-mt-1 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-destructive">
                                                {addError}
                                                <button type="button" className="imcrm-font-medium imcrm-underline" onClick={() => setFullForm(true)}>
                                                    {__('Completar en el formulario')}
                                                </button>
                                            </p>
                                        )}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                        {showTotals && <TotalsRow columns={p.columns} sums={sums} extraCell={actionsCol} />}
                    </table>
                </div>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-px-3 imcrm-py-2">
                    {p.relation && canCreate && !adding ? (
                        <Button variant="ghost" size="sm" className="imcrm-h-8 imcrm-gap-1.5 imcrm-px-2 imcrm-text-xs" onClick={startAdding} data-editable-add>
                            <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Agregar ítem')}
                        </Button>
                    ) : (
                        <span />
                    )}
                    <ShowingNote p={p} />
                </div>
                {fullForm && p.relation && (
                    <RecordCreateDialog
                        listId={p.listId}
                        listName={p.listName}
                        fields={p.fields}
                        open={fullForm}
                        onOpenChange={(o) => {
                            setFullForm(o);
                            if (!o) {
                                setAddError(null);
                                setDraft('');
                                p.onChanged?.();
                            }
                        }}
                        initialValues={{
                            [p.relation.field.slug]: [p.relation.recordId],
                            ...(titleTypable && titleField && draft.trim() ? { [titleField.slug]: draft.trim() } : {}),
                        }}
                    />
                )}
            </div>
        </RecordUpdaterProvider>
    );
}
