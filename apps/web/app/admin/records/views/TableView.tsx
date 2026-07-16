import { useMemo, useRef, useState } from 'react';
import {
    flexRender,
    getCoreRowModel,
    useReactTable,
    type ColumnDef,
    type ColumnOrderState,
    type ColumnSizingState,
    type VisibilityState,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown, GripVertical, Inbox, KeyRound, Plus } from 'lucide-react';

import { EmptyState } from '@/components/ui/empty-state';
import { useAggregates } from '@/hooks/useAggregates';
import { RecurrencesBatchProvider } from '@/hooks/useRecurrences';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCanAny } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { FilterTree, RecordEntity } from '@/types/record';

import { EditableCell } from '@/admin/records/EditableCell';
import { FieldHeaderMenu } from '@/admin/records/FieldHeaderMenu';
import { renderCellValue } from '@/admin/records/renderCellValue';
import type { ActiveSort } from '@/admin/records/recordsState';
import { FooterAggregateCell, type AggregateKind } from './FooterAggregateCell';
import { StickyHScrollbar } from './StickyHScrollbar';

interface TableViewProps {
    listId: number;
    /** Slug de la lista — para queries que necesitan slug en la URL (aggregates). */
    listSlug?: string;
    fields: FieldEntity[];
    records: RecordEntity[];
    sort: ActiveSort[];
    onSortChange: (fieldId: number, multi: boolean) => void;
    selectedIds: number[];
    onSelectionChange: (ids: number[]) => void;
    onRowClick?: (record: RecordEntity) => void;
    /** Estado de visibilidad de columnas (Excel-style). */
    columnVisibility: VisibilityState;
    onColumnVisibilityChange: (next: VisibilityState) => void;
    /** Anchuras de columnas en px (resizable). */
    columnSizing: ColumnSizingState;
    onColumnSizingChange: (next: ColumnSizingState) => void;
    /**
     * Orden custom de columnas (TanStack convention): array de column ids.
     * Cuando está vacío usa el orden default (field.position).
     * Se actualiza con drag-and-drop sobre los headers.
     */
    columnOrder: ColumnOrderState;
    onColumnOrderChange: (next: ColumnOrderState) => void;
    /**
     * Filtros activos — se pasan al hook de aggregates para que el
     * footer respete el filtro visible.
     */
    filterTree?: FilterTree;
    /** Click en "+ Nueva tarea" al final de la tabla. Si no se pasa, no se renderea. */
    onAddRecord?: () => void;
    /** Click en "+ Agregar columna" al final del header. Si no se pasa, no se renderea. */
    onAddColumn?: () => void;
    /**
     * Abre el editor del campo (FieldCreateDialog en modo edición) —
     * habilita el menú contextual "⌄" del header de cada columna de
     * campo (Modificar/Renombrar/Duplicar/Copiar ID/Eliminar). Si no
     * se pasa (p.ej. sin cap manage_lists), el menú no se renderea.
     */
    onEditField?: (field: FieldEntity) => void;
    /**
     * Cálculo opt-in elegido por el user para cada columna del
     * footer. Map `{column_id: kind_slug}`. Si la column id no
     * está acá, el footer muestra "Calcular ▾" como CTA.
     */
    footerAggregates?: Record<string, string>;
    onFooterAggregatesChange?: (next: Record<string, string>) => void;
    /** Total de registros (para porcentajes en el footer). */
    totalCount?: number;
}

/**
 * Vista de tabla sobre TanStack Table v8.
 *
 * - Columna de checkbox al inicio para selección múltiple.
 * - Headers clickeables: sort asc → desc → off; shift+click para multi.
 * - Celdas editables inline (delegado a `EditableCell`).
 * - Click en zona vacía de la fila → onRowClick (drawer).
 * - Tipos no soportados inline (user, file, relation) muestran solo
 *   lectura aquí; se editan desde RecordDetailDrawer.
 */
export function TableView({
    listId,
    listSlug,
    fields,
    records,
    sort,
    onSortChange,
    selectedIds,
    onSelectionChange,
    onRowClick,
    columnVisibility,
    onColumnVisibilityChange,
    columnSizing,
    onColumnSizingChange,
    columnOrder,
    onColumnOrderChange,
    filterTree,
    onAddRecord,
    onAddColumn,
    onEditField,
    footerAggregates,
    onFooterAggregatesChange,
    totalCount,
}: TableViewProps): JSX.Element {
    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

    // Gating de edición inline por capability (Fase 7 — follow-up).
    // El backend rechaza un PATCH sin la cap con 403; acá deshabilitamos
    // el doble-click → input UX para evitar la confusión del 403-on-submit.
    const canEditRecords = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);

    // Drag-and-drop column reorder: trackeamos qué column está siendo
    // arrastrada en local state (no persiste). Al drop, computamos el
    // nuevo orden y se lo pasamos al parent vía `onColumnOrderChange`.
    const [draggingColId, setDraggingColId] = useState<string | null>(null);
    const [overColId, setOverColId] = useState<string | null>(null);

    const allVisibleSelected =
        records.length > 0 && records.every((r) => selectedSet.has(r.id));
    const someVisibleSelected =
        !allVisibleSelected && records.some((r) => selectedSet.has(r.id));

    const toggleAll = (): void => {
        if (allVisibleSelected) {
            const visible = new Set(records.map((r) => r.id));
            onSelectionChange(selectedIds.filter((id) => !visible.has(id)));
        } else {
            const next = new Set(selectedIds);
            for (const r of records) next.add(r.id);
            onSelectionChange([...next]);
        }
    };

    const toggleOne = (id: number): void => {
        if (selectedSet.has(id)) {
            onSelectionChange(selectedIds.filter((x) => x !== id));
        } else {
            onSelectionChange([...selectedIds, id]);
        }
    };

    // fieldId (del meta de la columna) → FieldEntity, para el menú
    // contextual del header (necesita el entity completo).
    const fieldsById = useMemo(
        () => new Map(fields.map((f) => [f.id, f])),
        [fields],
    );

    const columns = useMemo<ColumnDef<RecordEntity>[]>(() => {
        const dynamic = fields
            .filter((f) => f.type !== 'relation')
            .sort((a, b) => a.position - b.position)
            .map<ColumnDef<RecordEntity>>((field) => ({
                id: field.slug,
                header: field.label,
                accessorFn: (row) => row.fields[field.slug],
                cell: (ctx) => (
                    <EditableCell
                        listId={listId}
                        recordId={ctx.row.original.id}
                        field={field}
                        value={ctx.getValue()}
                        canEdit={canEditRecords}
                    />
                ),
                size: defaultSizeForType(field.type),
                minSize: 80,
                maxSize: 800,
                meta: { fieldId: field.id, primary: field.is_primary },
            }));

        return [
            {
                id: 'id',
                header: __('ID'),
                accessorFn: (row) => row.id,
                cell: (ctx) => (
                    <span className="imcrm-font-mono imcrm-text-xs imcrm-text-muted-foreground">
                        #{String(ctx.getValue())}
                    </span>
                ),
                size: 70,
                minSize: 60,
                maxSize: 120,
                meta: { fieldId: null },
            },
            ...dynamic,
            {
                id: 'updated_at',
                header: __('Actualizado'),
                accessorFn: (row) => row.updated_at,
                cell: (ctx) => {
                    const v = String(ctx.getValue() ?? '');
                    if (!v) return null;
                    const d = new Date(v + 'Z');
                    return (
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">
                            {d.toLocaleString()}
                        </span>
                    );
                },
                size: 170,
                minSize: 130,
                maxSize: 260,
                meta: { fieldId: null },
            },
        ];
    }, [fields, listId, canEditRecords]);

    // Footer aggregations: pedimos sum/avg/count/min/max para todos
    // los fields visibles que son numéricos / fecha / checkbox / etc.
    // Solo si el caller pasó listSlug (caller controla si el footer
    // se necesita — algunos contextos como GroupedTableView lo
    // calculan aparte).
    const aggregatableFieldIds = useMemo(
        () => fields
            .filter((f) => f.type !== 'relation' && f.type !== 'computed')
            .filter((f) => columnVisibility[f.slug] !== false)
            .map((f) => f.id),
        [fields, columnVisibility],
    );
    const aggregates = useAggregates({
        listSlug,
        fieldIds: aggregatableFieldIds,
        filterTree,
    });

    const table = useReactTable({
        data: records,
        columns,
        getCoreRowModel: getCoreRowModel(),
        columnResizeMode: 'onChange',
        state: {
            columnVisibility,
            columnSizing,
            columnOrder,
        },
        onColumnVisibilityChange: (updater) => {
            const next = typeof updater === 'function' ? updater(columnVisibility) : updater;
            onColumnVisibilityChange(next);
        },
        onColumnSizingChange: (updater) => {
            const next = typeof updater === 'function' ? updater(columnSizing) : updater;
            onColumnSizingChange(next);
        },
        onColumnOrderChange: (updater) => {
            const next = typeof updater === 'function' ? updater(columnOrder) : updater;
            onColumnOrderChange(next);
        },
    });

    // Virtualization (Fase 17.C — DEFERRED #1).
    //
    // Strategy: la `<table>` HTML se mantiene intacta para preservar
    // column resize, sticky, drag-and-drop y todas las features
    // existentes. `useVirtualizer` controla solo el subset de rows
    // a renderizar; las "no visibles" se reemplazan por dos <tr>
    // spacer (padding-top + padding-bottom) que mantienen la altura
    // total del scroll correcto.
    //
    // Activación: solo con `> 100` rows. Para listas chicas, render
    // tradicional (sin overhead del virtualizer).
    const tableContainerRef = useRef<HTMLDivElement>(null);
    const rows = table.getRowModel().rows;
    const VIRTUALIZATION_THRESHOLD = 100;
    const shouldVirtualize = rows.length > VIRTUALIZATION_THRESHOLD;

    const rowVirtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => tableContainerRef.current,
        // 40px es el alto típico de una row (py-2.5 = 10px×2 + ~20px
        // de contenido). Real heights pueden variar — virtualizer
        // mide post-render y ajusta. Estimate solo afecta el reserve
        // inicial del scrollbar.
        estimateSize: () => 40,
        // Buffer: rows extra renderizadas arriba/abajo del viewport
        // para que el scroll fluido no muestre "huecos blancos"
        // mientras los nuevos rows pintan.
        overscan: 10,
        enabled: shouldVirtualize,
    });

    const virtualRows = shouldVirtualize ? rowVirtualizer.getVirtualItems() : [];
    const virtualTotalSize = shouldVirtualize ? rowVirtualizer.getTotalSize() : 0;
    const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
    const paddingBottom = virtualRows.length > 0
        ? virtualTotalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
        : 0;

    /**
     * Reordena `columnOrder` insertando `dragged` justo antes de
     * `target`. Si el `columnOrder` está vacío, lo derivamos del
     * orden actual de columnas (necesario para el primer drag — sin
     * esto, persistiríamos solo dos columnas y el resto quedaría al
     * principio en el orden default).
     */
    const reorderColumns = (dragged: string, target: string): void => {
        if (dragged === target) return;
        const currentOrder = columnOrder.length > 0
            ? [...columnOrder]
            : table.getAllLeafColumns().map((c) => c.id);
        const fromIdx = currentOrder.indexOf(dragged);
        const toIdx   = currentOrder.indexOf(target);
        if (fromIdx < 0 || toIdx < 0) return;
        currentOrder.splice(fromIdx, 1);
        // Si `dragged` estaba antes de `target`, los índices se
        // recalculan: insertamos en el `toIdx` original ajustado.
        const insertAt = fromIdx < toIdx ? toIdx - 1 : toIdx;
        currentOrder.splice(insertAt, 0, dragged);
        onColumnOrderChange(currentOrder);
    };

    // Sticky-left: la PRIMERA columna dinámica visible queda fija en
    // `left: 0` (ancla la fila al scrollear horizontal). El checkbox
    // ya no es sticky — scrollea con el resto de columnas. UX igual
    // a ClickUp: la columna fija es la que ancla la fila visualmente
    // (típicamente "Nombre"), no los controles de selección.
    //
    // Cuál es esa primera columna dinámica? Tomamos la primera columna
    // visible (en column order) cuyo `meta.fieldId !== null` (es decir,
    // descartamos `id` y `updated_at` de TanStack si están al inicio
    // del orden, aunque normalmente `id` está oculto y `updated_at` al
    // final).
    const stickyColumnId = useMemo(() => {
        const visibleLeaves = table.getVisibleLeafColumns();
        for (const c of visibleLeaves) {
            const m = c.columnDef.meta as { fieldId: number | null } | undefined;
            if (m && m.fieldId !== null) return c.id;
        }
        return null;
    }, [table, columnOrder, columnVisibility]);
    const stickyStyleFor = (columnId: string): React.CSSProperties | undefined => {
        if (columnId === stickyColumnId) {
            return { position: 'sticky' as const, left: 0, zIndex: 1 };
        }
        return undefined;
    };

    // El `<thead sticky>` solo proyecta sombra cuando el contenedor
    // tiene scroll vertical activo. Sin scroll, el header se ve plano
    // (estilo ClickUp). On scroll, sombra suave indica que hay
    // contenido pasando por debajo.
    const [scrolled, setScrolled] = useState(false);

    // IDs visibles: alimenta el batch fetch de recurrencias para la
    // página actual de records. UNA sola query reemplaza el N+1 que
    // pegaban las celdas de fecha individuales antes.
    const visibleRecordIds = useMemo(() => records.map((r) => r.id), [records]);

    return (
      <RecurrencesBatchProvider listId={listId} recordIds={visibleRecordIds}>
       <>
        <div
            // Solo scroll HORIZONTAL acá adentro (columnas anchas). El
            // vertical es el de la PÁGINA (main del shell) — la tabla
            // crece a su alto natural; el usuario pidió explícitamente
            // una sola barra al borde derecho de la ventana, sin scroll
            // interno de la tabla.
            // Sin card chrome (border/rounded/shadow/bg-card): la tabla
            // va plana sobre el canvas, estilo ClickUp — solo hairlines.
            ref={tableContainerRef}
            className="imcrm-overflow-x-auto"
            role="region"
            aria-label={__('Tabla de registros')}
            onScroll={(e) => {
                const top = (e.currentTarget as HTMLDivElement).scrollTop > 0;
                if (top !== scrolled) setScrolled(top);
            }}
        >
            <table
                className="imcrm-w-full imcrm-text-sm"
                // `width: 100%` + `minWidth: totalSize`: la tabla llena el
                // contenedor (las columnas estiran proporcionalmente, sin
                // vacío a la derecha) y conserva el scroll horizontal
                // cuando la suma de anchos supera el viewport.
                style={{ tableLayout: 'fixed', width: '100%', minWidth: table.getCenterTotalSize() }}
                aria-label={__('Registros de la lista')}
            >
                <thead
                    className={cn(
                        'imcrm-sticky imcrm-top-0 imcrm-z-20 imcrm-bg-background imcrm-transition-shadow imcrm-duration-150',
                        scrolled && 'imcrm-shadow-[0_2px_4px_-1px_rgba(0,0,0,0.06)]',
                    )}
                >
                    {table.getHeaderGroups().map((hg) => (
                        <tr key={hg.id} className="imcrm-border-b imcrm-border-border">
                            <th
                                scope="col"
                                className="imcrm-w-10 imcrm-px-3 imcrm-py-2"
                            >
                                <input
                                    type="checkbox"
                                    checked={allVisibleSelected}
                                    ref={(el) => {
                                        if (el) el.indeterminate = someVisibleSelected;
                                    }}
                                    onChange={toggleAll}
                                    aria-label={__('Seleccionar todos')}
                                />
                            </th>
                            {hg.headers.map((h) => {
                                const meta = h.column.columnDef.meta as
                                    | { fieldId: number | null; primary?: boolean }
                                    | undefined;
                                const fieldId = meta?.fieldId ?? null;
                                const isPrimary = meta?.primary ?? false;
                                const sortIndex = fieldId !== null
                                    ? sort.findIndex((s) => s.field_id === fieldId)
                                    : -1;
                                const sortDir = sortIndex >= 0 ? sort[sortIndex]?.dir : null;
                                const ariaSort: 'ascending' | 'descending' | 'none' =
                                    sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : 'none';
                                // ID y updated_at no son re-orderables — los demás (los
                                // de campos del usuario) sí.
                                const isDraggable = fieldId !== null;
                                const isDragOver = overColId === h.id && draggingColId !== h.id;

                                const stickyStyle = stickyStyleFor(h.id);
                                return (
                                    <th
                                        key={h.id}
                                        scope="col"
                                        aria-sort={fieldId !== null ? ariaSort : undefined}
                                        style={{
                                            width: h.getSize(),
                                            ...(stickyStyle ?? {}),
                                        }}
                                        draggable={isDraggable}
                                        onDragStart={isDraggable ? (e) => {
                                            setDraggingColId(h.id);
                                            // Algunos navegadores (Firefox) requieren
                                            // setData para iniciar el drag.
                                            e.dataTransfer.effectAllowed = 'move';
                                            e.dataTransfer.setData('text/plain', h.id);
                                        } : undefined}
                                        onDragEnd={() => {
                                            setDraggingColId(null);
                                            setOverColId(null);
                                        }}
                                        onDragOver={isDraggable ? (e) => {
                                            if (draggingColId === null || draggingColId === h.id) return;
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = 'move';
                                            if (overColId !== h.id) setOverColId(h.id);
                                        } : undefined}
                                        onDrop={isDraggable ? (e) => {
                                            e.preventDefault();
                                            if (draggingColId !== null) {
                                                reorderColumns(draggingColId, h.id);
                                            }
                                            setDraggingColId(null);
                                            setOverColId(null);
                                        } : undefined}
                                        // Click DERECHO sobre el header = abrir el menú
                                        // contextual de la columna (además del chevron).
                                        onContextMenu={
                                            fieldId !== null && onEditField !== undefined
                                                ? (e) => {
                                                    const btn = e.currentTarget.querySelector('button[aria-haspopup="menu"]') as HTMLButtonElement | null;
                                                    if (!btn) return;
                                                    e.preventDefault();
                                                    // Radix DropdownMenu abre en pointerdown (no en click).
                                                    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
                                                }
                                                : undefined
                                        }
                                        className={cn(
                                            'imcrm-group/th imcrm-relative imcrm-whitespace-nowrap imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-[11px] imcrm-font-semibold imcrm-text-muted-foreground imcrm-uppercase imcrm-tracking-[0.06em]',
                                            // Sticky cells necesitan bg sólido para
                                            // tapar las celdas que pasan por detrás
                                            // horizontalmente al scrollear.
                                            stickyStyle && 'imcrm-bg-background',
                                            isDragOver && 'imcrm-bg-primary/10',
                                            draggingColId === h.id && 'imcrm-opacity-50',
                                        )}
                                    >
                                        <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1">
                                            {isDraggable && (
                                                <span
                                                    className="imcrm-cursor-grab imcrm-text-muted-foreground/40 imcrm-opacity-0 imcrm-transition-opacity group-hover/th:imcrm-opacity-100 active:imcrm-cursor-grabbing"
                                                    aria-hidden
                                                    title={__('Arrastra para reordenar')}
                                                >
                                                    <GripVertical className="imcrm-h-3 imcrm-w-3" />
                                                </span>
                                            )}
                                            {fieldId !== null ? (
                                                <button
                                                    type="button"
                                                    onClick={(e) => onSortChange(fieldId, e.shiftKey)}
                                                    className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-rounded hover:imcrm-text-foreground"
                                                >
                                                    {isPrimary && (
                                                        <KeyRound className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-primary" aria-hidden="true" />
                                                    )}
                                                    <span className="imcrm-truncate">
                                                        {h.isPlaceholder
                                                            ? null
                                                            : flexRender(h.column.columnDef.header, h.getContext())}
                                                    </span>
                                                    <SortIndicator dir={sortDir ?? null} index={sortIndex} multiCount={sort.length} />
                                                </button>
                                            ) : h.isPlaceholder ? null : (
                                                flexRender(h.column.columnDef.header, h.getContext())
                                            )}
                                            {fieldId !== null
                                                && onEditField !== undefined
                                                && fieldsById.has(fieldId) && (
                                                <FieldHeaderMenu
                                                    listId={listId}
                                                    field={fieldsById.get(fieldId)!}
                                                    onEdit={onEditField}
                                                />
                                            )}
                                        </div>
                                        {/* Resize handle estilo Excel: barra
                                            de 4px al borde derecho del <th>.
                                            Antes era de 1px transparent y el
                                            user no la encontraba. Ahora es
                                            visible (border) y resalta a
                                            primary on hover. */}
                                        {h.column.getCanResize() && (
                                            <div
                                                onMouseDown={(e) => {
                                                    // Al iniciar resize, prevenir que el
                                                    // mousedown burbujee al draggable=<th>
                                                    // (sino el browser inicia un drag de
                                                    // columna en lugar del resize).
                                                    e.stopPropagation();
                                                    h.getResizeHandler()(e);
                                                }}
                                                onTouchStart={h.getResizeHandler()}
                                                onClick={(e) => e.stopPropagation()}
                                                draggable={false}
                                                onDragStart={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                }}
                                                className={cn(
                                                    'imcrm-absolute imcrm-right-0 imcrm-top-0 imcrm-h-full imcrm-w-1 imcrm-cursor-col-resize imcrm-select-none imcrm-touch-none imcrm-z-20',
                                                    'imcrm-bg-border/40 hover:imcrm-bg-primary/60',
                                                    h.column.getIsResizing() && 'imcrm-bg-primary imcrm-w-[2px]',
                                                )}
                                                aria-hidden
                                            />
                                        )}
                                    </th>
                                );
                            })}
                            {onAddColumn && (
                                <th
                                    scope="col"
                                    className="imcrm-w-12 imcrm-px-2 imcrm-py-2 imcrm-text-left"
                                >
                                    <button
                                        type="button"
                                        onClick={onAddColumn}
                                        className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-border imcrm-border-dashed imcrm-border-border imcrm-text-muted-foreground hover:imcrm-border-primary hover:imcrm-bg-primary/10 hover:imcrm-text-primary"
                                        title={__('Agregar columna')}
                                        aria-label={__('Agregar columna')}
                                    >
                                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </button>
                                </th>
                            )}
                        </tr>
                    ))}
                </thead>
                <tbody>
                    {rows.length === 0 ? (
                        <tr>
                            <td
                                colSpan={columns.length + 1}
                                className="imcrm-px-4 imcrm-py-8"
                            >
                                <EmptyState
                                    icon={Inbox}
                                    title={__('No hay registros')}
                                    description={__('Esta lista todavía no tiene registros que coincidan con los filtros actuales.')}
                                    variant="bare"
                                />
                            </td>
                        </tr>
                    ) : (
                        <>
                            {paddingTop > 0 && (
                                <tr aria-hidden style={{ height: `${paddingTop}px` }}>
                                    <td colSpan={columns.length + 1} />
                                </tr>
                            )}
                            {(shouldVirtualize
                                ? virtualRows.map((vi) => rows[vi.index]!)
                                : rows
                            ).map((row) => {
                            const isSelected = selectedSet.has(row.original.id);
                            return (
                                <tr
                                    key={row.id}
                                    className={cn(
                                        // Sin `transition-colors` aquí — daba lag
                                        // perceptible en hover (200ms de wait con
                                        // duration-100 antes de la primera frame).
                                        // Hover bg debe ser instantáneo.
                                        'imcrm-group/row imcrm-border-t imcrm-border-border/50',
                                        isSelected
                                            ? 'imcrm-bg-primary/5'
                                            : 'hover:imcrm-bg-muted/40',
                                    )}
                                >
                                    <td
                                        className="imcrm-w-10 imcrm-px-3 imcrm-py-2.5 imcrm-align-middle"
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <input
                                            type="checkbox"
                                            checked={isSelected}
                                            onChange={() => toggleOne(row.original.id)}
                                            aria-label={sprintf(
                                                /* translators: %d: record ID */
                                                __('Seleccionar registro %d'),
                                                row.original.id,
                                            )}
                                        />
                                    </td>
                                    {row.getVisibleCells().map((cell, cellIndex) => {
                                        // El "ID" (primera celda dinámica) actúa como zona de drawer:
                                        // click ahí abre el drawer.
                                        const isOpenerCell = cellIndex === 0;
                                        const cellSticky = stickyStyleFor(cell.column.id);
                                        return (
                                            <td
                                                key={cell.id}
                                                style={{
                                                    width: cell.column.getSize(),
                                                    maxWidth: cell.column.getSize(),
                                                    ...(cellSticky ?? {}),
                                                }}
                                                className={cn(
                                                    // `overflow-hidden` + `width/maxWidth` cortan el
                                                    // desbordamiento visual de cells largas (long_text,
                                                    // multi_select con muchas opciones). El truncate
                                                    // con elipsis va dentro de `EditableCell` para que
                                                    // afecte solo al modo lectura — el editor inline
                                                    // necesita escaparse del clip cuando el user clickea.
                                                    'imcrm-overflow-hidden imcrm-px-3 imcrm-py-2.5 imcrm-align-middle',
                                                    cellSticky && (isSelected
                                                        ? 'imcrm-bg-primary/5'
                                                        : 'imcrm-bg-background group-hover/row:imcrm-bg-muted/40'),
                                                    isOpenerCell && onRowClick && 'imcrm-cursor-pointer imcrm-font-medium',
                                                )}
                                                onClick={
                                                    isOpenerCell && onRowClick
                                                        ? () => onRowClick(row.original)
                                                        : undefined
                                                }
                                            >
                                                {flexRender(cell.column.columnDef.cell, cell.getContext())}
                                            </td>
                                        );
                                    })}
                                    {onAddColumn && <td className="imcrm-w-12" />}
                                </tr>
                            );
                        })}
                            {paddingBottom > 0 && (
                                <tr aria-hidden style={{ height: `${paddingBottom}px` }}>
                                    <td colSpan={columns.length + 1} />
                                </tr>
                            )}
                        </>
                    )}
                </tbody>
                {/* Footer unificado (estilo ClickUp): UNA sola fila con
                    "+ Agregar tarea" en la primera columna dinámica y
                    Calcular dropdown en las demás. Las cells de Calcular
                    están invisibles por default y solo aparecen on hover
                    de la fila (vía `group/footer`). El bg matchea el body
                    — sin separador visual entre contenido y footer. */}
                {(onAddRecord || onFooterAggregatesChange) && (
                    <tfoot className="imcrm-group/footer">
                        <tr className="imcrm-border-t imcrm-border-border/50">
                            <td className="imcrm-w-10" />
                            {table.getVisibleLeafColumns().map((col) => {
                                const meta = col.columnDef.meta as
                                    | { fieldId: number | null; primary?: boolean }
                                    | undefined;
                                const fieldId = meta?.fieldId ?? null;
                                const field: FieldEntity | null = fieldId !== null
                                    ? (fields.find((f) => f.id === fieldId) ?? null)
                                    : null;
                                const cellSticky = stickyStyleFor(col.id);
                                const isFirstDynamic = col.id === stickyColumnId;

                                // Primera columna dinámica: "+ Agregar
                                // tarea" (en lugar de Calcular).
                                if (isFirstDynamic && onAddRecord) {
                                    return (
                                        <td
                                            key={col.id}
                                            style={{
                                                width: col.getSize(),
                                                maxWidth: col.getSize(),
                                                ...(cellSticky ?? {}),
                                            }}
                                            className={cn(
                                                'imcrm-overflow-hidden imcrm-px-1 imcrm-py-1 imcrm-align-middle',
                                                cellSticky && 'imcrm-bg-background',
                                            )}
                                        >
                                            <button
                                                type="button"
                                                onClick={onAddRecord}
                                                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-1.5 imcrm-py-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-muted/40 hover:imcrm-text-foreground"
                                            >
                                                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                                {__('Agregar tarea')}
                                            </button>
                                        </td>
                                    );
                                }

                                // Resto: Calcular dropdown si aplica.
                                if (! onFooterAggregatesChange) {
                                    return (
                                        <td
                                            key={col.id}
                                            style={{
                                                width: col.getSize(),
                                                maxWidth: col.getSize(),
                                                ...(cellSticky ?? {}),
                                            }}
                                            className={cn(cellSticky && 'imcrm-bg-background')}
                                        />
                                    );
                                }
                                const agg = field !== null && aggregates.data
                                    ? aggregates.data.totals[field.slug]
                                    : undefined;
                                const kind = (footerAggregates ?? {})[col.id] as AggregateKind | undefined;
                                return (
                                    <td
                                        key={col.id}
                                        style={{
                                            width: col.getSize(),
                                            maxWidth: col.getSize(),
                                            ...(cellSticky ?? {}),
                                        }}
                                        className={cn(
                                            'imcrm-overflow-hidden imcrm-px-1 imcrm-py-1 imcrm-align-middle',
                                            cellSticky && 'imcrm-bg-background',
                                        )}
                                    >
                                        <FooterAggregateCell
                                            field={field}
                                            totalCount={totalCount ?? 0}
                                            agg={agg}
                                            kind={kind}
                                            onChange={(nextKind) => {
                                                const next = { ...(footerAggregates ?? {}) };
                                                if (nextKind === undefined) {
                                                    delete next[col.id];
                                                } else {
                                                    next[col.id] = nextKind;
                                                }
                                                onFooterAggregatesChange(next);
                                            }}
                                        />
                                    </td>
                                );
                            })}
                            {onAddColumn && <td className="imcrm-w-12" />}
                        </tr>
                    </tfoot>
                )}
            </table>
        </div>
        {/* Scrollbar horizontal fija al fondo del viewport (estilo
            ClickUp) — la nativa del wrapper queda al fondo de la tabla,
            invisible en listas largas. */}
        <StickyHScrollbar targetRef={tableContainerRef} />
       </>
      </RecurrencesBatchProvider>
    );
}


/**
 * Anchura inicial razonable según el tipo del campo. El usuario puede
 * resizear manualmente; estas son solo defaults antes del primer drag.
 */
function defaultSizeForType(type: string): number {
    switch (type) {
        case 'checkbox':
            return 90;
        case 'number':
        case 'currency':
            return 120;
        case 'date':
            return 130;
        case 'datetime':
            return 170;
        case 'select':
            return 140;
        case 'multi_select':
            return 200;
        case 'email':
        case 'url':
            return 220;
        case 'long_text':
            return 280;
        default:
            return 180;
    }
}

function SortIndicator({
    dir,
    index,
    multiCount,
}: {
    dir: 'asc' | 'desc' | null;
    index: number;
    multiCount: number;
}): JSX.Element | null {
    // El estado de sort ya está expuesto al SR vía aria-sort en el <th>;
    // los iconos solo son decorativos.
    if (dir === null) {
        return <ArrowUpDown className="imcrm-h-3 imcrm-w-3 imcrm-opacity-30" aria-hidden="true" />;
    }
    return (
        <span className="imcrm-flex imcrm-items-center imcrm-gap-0.5" aria-hidden="true">
            {dir === 'asc' ? (
                <ArrowUp className="imcrm-h-3 imcrm-w-3 imcrm-text-primary" />
            ) : (
                <ArrowDown className="imcrm-h-3 imcrm-w-3 imcrm-text-primary" />
            )}
            {multiCount > 1 && (
                <span className="imcrm-font-mono imcrm-text-[9px] imcrm-text-primary">{index + 1}</span>
            )}
        </span>
    );
}

export { renderCellValue };
