import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Link2, Plus, Table2 } from 'lucide-react';
import { readStoreListMarker } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useFields } from '@/hooks/useFields';
import { useList } from '@/hooks/useLists';
import { invalidateForList, recordsKeys, useRecords } from '@/hooks/useRecords';
import { useRelationPaths, type RelationPath } from '@/hooks/useRelationPaths';
import { backlinksQuery } from '@/hooks/useRecordView';
import { __, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import type { FieldEntity } from '@/types/field';

import { FieldValueDisplay } from './crm/FieldValueDisplay';
import { EditableRelatedTable, type EditableRow } from './EditableRelatedTable';
import { RecordCreateDialog } from './RecordCreateDialog';

/** Tipos que no aportan en una fila compacta. */
const SKIP_TYPES = new Set(['relation', 'long_text', 'file']);

/**
 * «Vinculados» (v0.1.209): los registros de OTRAS listas que apuntan a éste
 * por un campo relation — las líneas de una orden de compra, los pedidos de
 * un cliente. Sin esto, la relación sólo se veía desde el lado que la tiene.
 * Cada grupo se pide con `related_to=<campo>:<registro>` (un request por
 * relación, no por registro) y «Agregar» abre el alta con la relación ya
 * cargada.
 */
export function RecordBacklinks({ listId, recordId }: { listId: number; recordId: number }): JSX.Element | null {
    const paths = useRelationPaths(listId);
    const reverse = (paths.data ?? []).filter((p) => p.direction === 'reverse');
    if (reverse.length === 0) return null;
    return (
        <section className="imcrm-mt-6 imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-record-backlinks">
            <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-semibold">
                <Link2 className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                {__('Vinculados')}
            </h3>
            {reverse.map((p) => (
                <BacklinkGroup key={`${p.relation_field_id}`} path={p} recordId={recordId} baseListId={listId} />
            ))}
        </section>
    );
}

/** v0.1.292 — Qué grupos se ven como tabla editable (por relación, en este navegador). */
const EDITABLE_KEY = 'imcrm:backlinks-editable:';

function readEditable(relationFieldId: number): boolean {
    try {
        return window.localStorage.getItem(EDITABLE_KEY + relationFieldId) === '1';
    } catch {
        return false;
    }
}

function writeEditable(relationFieldId: number, on: boolean): void {
    try {
        if (on) window.localStorage.setItem(EDITABLE_KEY + relationFieldId, '1');
        else window.localStorage.removeItem(EDITABLE_KEY + relationFieldId);
    } catch {
        // Sin almacenamiento la elección dura lo que la pestaña.
    }
}

/** Cuántos ítems trae la tabla editable si hay más que los del bundle. */
const EDITABLE_ROWS = 100;

function BacklinkGroup({ path, recordId, baseListId }: { path: RelationPath; recordId: number; baseListId: number }): JSX.Element {
    const qc = useQueryClient();
    const list = useList(path.list_id);
    const fields = useFields(path.list_id);
    // La MISMA query que siembra el bundle de la ficha (`useRecordView`).
    const records = useRecords(path.list_id, backlinksQuery(path.relation_field_id, recordId));
    const [open, setOpen] = useState(true);
    const [adding, setAdding] = useState(false);
    const [editableMode, setEditableMode] = useState(() => readEditable(path.relation_field_id));
    // La tabla editable suma TODO: si hay más ítems que los del bundle, se
    // piden (hasta 100) sólo en ese caso.
    const seeded = records.data;
    const needMore = editableMode && seeded !== undefined && (seeded.meta.total ?? seeded.data.length) > seeded.data.length;
    const more = useRecords(needMore ? path.list_id : undefined, {
        page: 1,
        per_page: EDITABLE_ROWS,
        related_to: `${path.relation_field_id}:${recordId}`,
    });

    const all: FieldEntity[] = useMemo(() => fields.data ?? [], [fields.data]);
    const relField = all.find((f) => f.id === path.relation_field_id);
    const title = all.find((f) => f.is_primary) ?? all.find((f) => f.type === 'text');
    const columns = useMemo(
        () => all.filter((f) => f.id !== title?.id && !SKIP_TYPES.has(f.type)).slice(0, 4),
        [all, title?.id],
    );
    const source = needMore && more.data ? more.data : records.data;
    const rows = useMemo(() => source?.data ?? [], [source]);
    const total = source?.meta.total ?? rows.length;
    const initialValues = useMemo(
        () => (relField ? { [relField.slug]: [recordId] } : undefined),
        [relField, recordId],
    );
    // Una lista de tienda no admite altas desde aquí (se crean en WooCommerce).
    const storeManaged = readStoreListMarker(list.data?.settings) !== null;
    const label = path.list_name === path.relation_label ? path.list_name : `${path.list_name} · ${path.relation_label}`;

    // v0.1.292 — Tabla editable: el título primero y las columnas de siempre (hasta 6).
    const editColumns = useMemo(
        () => (title ? [title] : []).concat(all.filter((f) => f.id !== title?.id && !SKIP_TYPES.has(f.type)).slice(0, 6)),
        [all, title],
    );
    const editRows = useMemo<EditableRow[]>(
        () => rows.map((r) => ({ id: r.id, value: (f: FieldEntity) => (f.type === 'relation' ? r.relations?.[f.slug] ?? [] : r.fields[f.slug]) })),
        [rows],
    );
    const totalIds = useMemo(() => editColumns.filter((f) => f.type === 'currency').map((f) => f.id), [editColumns]);
    // Los rollups del registro abierto (el total de la cotización) dependen de los ítems.
    const refreshBase = useCallback(() => invalidateForList(qc, recordsKeys.all, baseListId), [qc, baseListId]);
    const toggleEditable = (): void => {
        const next = !editableMode;
        setEditableMode(next);
        writeEditable(path.relation_field_id, next);
        if (next) setOpen(true);
    };

    return (
        <div className="imcrm-rounded-md imcrm-border imcrm-border-border" data-testid={`imcrm-backlinks-${path.relation_field_id}`}>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2">
                <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-1.5 imcrm-text-left imcrm-text-sm imcrm-font-medium"
                    aria-expanded={open}
                >
                    {open ? <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" /> : <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />}
                    <span className="imcrm-truncate">{label}</span>
                    <span className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-text-[11px] imcrm-font-medium imcrm-tabular-nums imcrm-text-muted-foreground">
                        {formatNumber(total)}
                    </span>
                </button>
                {fields.data && (
                    <Button
                        variant={editableMode ? 'secondary' : 'ghost'}
                        size="sm"
                        className="imcrm-h-7 imcrm-gap-1 imcrm-text-xs"
                        onClick={toggleEditable}
                        aria-pressed={editableMode}
                        title={editableMode ? __('Volver a la vista de solo lectura') : __('Editar los ítems en línea, con totales')}
                        data-testid={`imcrm-backlinks-editable-${path.relation_field_id}`}
                    >
                        <Table2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Tabla editable')}
                    </Button>
                )}
                {relField && fields.data && !storeManaged && !editableMode && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="imcrm-h-7 imcrm-gap-1 imcrm-text-xs"
                        onClick={() => setAdding(true)}
                        data-testid={`imcrm-backlinks-add-${path.relation_field_id}`}
                    >
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Agregar')}
                    </Button>
                )}
            </div>
            {open && editableMode && fields.data && list.data && (
                <EditableRelatedTable
                    listId={path.list_id}
                    listName={path.list_name}
                    fields={all}
                    columns={editColumns}
                    totalIds={totalIds}
                    rows={editRows}
                    total={total}
                    relation={relField ? { field: relField, recordId } : null}
                    storeMarker={readStoreListMarker(list.data.settings)}
                    onSaved={refreshBase}
                    onChanged={refreshBase}
                />
            )}
            {open && !editableMode && rows.length > 0 && (
                <div className="imcrm-overflow-x-auto imcrm-border-t imcrm-border-border">
                    <table className="imcrm-w-full imcrm-text-[13px]">
                        <thead className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            <tr>
                                <th className="imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-font-medium">{title?.label ?? __('Registro')}</th>
                                {columns.map((c) => (
                                    <th key={c.id} className="imcrm-whitespace-nowrap imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-font-medium">
                                        {c.label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((r) => (
                                <tr key={r.id} className="imcrm-border-t imcrm-border-border hover:imcrm-bg-accent/50">
                                    <td className="imcrm-px-3 imcrm-py-1.5">
                                        {list.data ? (
                                            <Link to={`/lists/${list.data.slug}/records/${r.id}`} className="imcrm-font-medium hover:imcrm-underline">
                                                {String((title ? r.fields[title.slug] : null) ?? '') || `#${r.id}`}
                                            </Link>
                                        ) : (
                                            `#${r.id}`
                                        )}
                                    </td>
                                    {columns.map((c) => (
                                        <td key={c.id} className="imcrm-whitespace-nowrap imcrm-px-3 imcrm-py-1.5">
                                            <FieldValueDisplay field={c} value={r.fields[c.slug]} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {total > rows.length && (
                        <p className="imcrm-border-t imcrm-border-border imcrm-px-3 imcrm-py-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                            {sprintf(__('Mostrando %1$s de %2$s.'), formatNumber(rows.length), formatNumber(total))}
                        </p>
                    )}
                </div>
            )}
            {adding && fields.data && (
                <RecordCreateDialog
                    listId={path.list_id}
                    listName={path.list_name}
                    fields={fields.data}
                    open={adding}
                    onOpenChange={setAdding}
                    initialValues={initialValues}
                />
            )}
        </div>
    );
}
