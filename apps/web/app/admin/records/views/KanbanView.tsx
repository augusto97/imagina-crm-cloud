import { useMemo, useState } from 'react';
import { ArrowRightLeft, GripVertical, MoreHorizontal } from 'lucide-react';

import { renderCellValue } from '@/admin/records/renderCellValue';
import { chipSoftStyle, colorVar, type OptionColor } from '@/components/ui/color-picker';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useRecordGroups, useUpdateRecord } from '@/hooks/useRecords';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { FilterTree, RecordEntity } from '@/types/record';

/**
 * Vista Kanban: tablero de columnas derivadas de las options del campo
 * `select` configurado como `group_by_field_id` en la saved view.
 *
 * Drag-and-drop nativo HTML5 — sin librerías externas. Funciona bien
 * para la UX básica del MVP (drag a otra columna). Si en el futuro
 * necesitamos reorder dentro de la columna o accesibilidad por
 * teclado, @dnd-kit es la siguiente parada.
 *
 * Card mínima: muestra el campo "primary" (o el primer text) como
 * título y un par de campos extra como meta. Click abre el drawer
 * (mismo flujo que la TableView).
 */
interface KanbanViewProps {
    listId: number;
    fields: FieldEntity[];
    records: RecordEntity[];
    groupByField: FieldEntity;
    onCardClick: (record: RecordEntity) => void;
    /**
     * IDs explícitos del título y de los meta fields a mostrar en
     * cada card. Si null/undefined, KanbanView cae al modo
     * heurístico previo (`pickTitleField` / `pickMetaFields`).
     * Permite que el user customice cuáles campos se muestran via
     * `EditKanbanViewDialog`.
     */
    titleFieldId?: number | null;
    metaFieldIds?: number[] | null;
    /**
     * v0.1.286 — filtros y búsqueda de la vista: los CONTADORES de cada
     * columna los da el servidor (todos los registros), no las tarjetas
     * cargadas (máx. 200).
     */
    filterTree?: FilterTree;
    search?: string;
}

interface SelectOption {
    value: string;
    label: string;
    color?: string;
}

const UNCATEGORIZED_KEY = '__uncategorized__';

export function KanbanView({
    listId,
    fields,
    records,
    groupByField,
    onCardClick,
    titleFieldId,
    metaFieldIds,
    filterTree,
    search,
}: KanbanViewProps): JSX.Element {
    const update = useUpdateRecord(listId);
    const groups = useRecordGroups(listId, {
        groupBy: groupByField.id,
        filterTree: filterTree && filterTree.children.length > 0 ? filterTree : undefined,
        search: search !== undefined && search.trim() !== '' ? search.trim() : undefined,
    });
    const serverCounts = useMemo(() => {
        const m = new Map<string, number>();
        for (const b of groups.data?.data ?? []) {
            m.set(b.value === null || b.value === '' ? UNCATEGORIZED_KEY : b.value, b.count);
        }
        return m;
    }, [groups.data]);
    const [draggingId, setDraggingId] = useState<number | null>(null);
    const [dropTarget, setDropTarget] = useState<string | null>(null);
    const [moveError, setMoveError] = useState<string | null>(null);

    const options = useMemo<SelectOption[]>(() => {
        const raw = groupByField.config?.options;
        if (!Array.isArray(raw)) return [];
        return raw
            .filter((o): o is SelectOption =>
                typeof o === 'object' &&
                o !== null &&
                'value' in o &&
                typeof (o as Record<string, unknown>).value === 'string',
            )
            .map((o) => ({
                value: String(o.value),
                label: typeof o.label === 'string' ? o.label : String(o.value),
                color: typeof o.color === 'string' ? o.color : undefined,
            }));
    }, [groupByField.config]);

    const grouped = useMemo(() => {
        const map = new Map<string, RecordEntity[]>();
        for (const opt of options) map.set(opt.value, []);
        map.set(UNCATEGORIZED_KEY, []);

        for (const record of records) {
            const v = record.fields[groupByField.slug];
            const key = typeof v === 'string' && v !== '' ? v : UNCATEGORIZED_KEY;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(record);
        }
        return map;
    }, [records, options, groupByField.slug]);

    // Honra el override explícito si el user lo configuró desde
     // `EditKanbanViewDialog`; si no, cae al modo heurístico.
    const titleField = useMemo(() => {
        if (titleFieldId) {
            const explicit = fields.find((f) => f.id === titleFieldId);
            if (explicit) return explicit;
        }
        return pickTitleField(fields, groupByField.id);
    }, [fields, groupByField.id, titleFieldId]);
    const metaFields = useMemo(() => {
        if (metaFieldIds && metaFieldIds.length > 0) {
            const fieldById = new Map(fields.map((f) => [f.id, f]));
            return metaFieldIds
                .map((id) => fieldById.get(id))
                .filter((f): f is FieldEntity => f !== undefined);
        }
        return pickMetaFields(fields, groupByField.id, titleField?.id);
    }, [fields, groupByField.id, titleField?.id, metaFieldIds]);

    const handleDrop = async (targetValue: string): Promise<void> => {
        setDropTarget(null);
        if (draggingId === null) return;
        await moveRecord(draggingId, targetValue);
    };

    /**
     * Mueve una tarjeta a otra columna. Lo usan el arrastre (mouse) y el menú
     * «Mover a…» de la tarjeta (v0.1.286): en el TELÉFONO no hay drag HTML5,
     * así que mover una tarjeta era imposible.
     */
    const moveRecord = async (recordId: number, targetValue: string): Promise<void> => {
        const record = records.find((r) => r.id === recordId);
        if (!record) {
            setDraggingId(null);
            return;
        }

        const currentValue = record.fields[groupByField.slug];
        const newValue = targetValue === UNCATEGORIZED_KEY ? null : targetValue;
        if (currentValue === newValue || (currentValue === undefined && newValue === null)) {
            setDraggingId(null);
            return;
        }

        setMoveError(null);
        try {
            await update.mutateAsync({
                id: record.id,
                values: { [groupByField.slug]: newValue },
            });
        } catch (err) {
            // El optimistic update de TanStack Query revierte la caché,
            // pero el usuario merece saber qué pasó (validación que
            // rechaza el valor, error de red, etc.) antes que ver el
            // card "saltar" silenciosamente de columna.
            setMoveError(err instanceof Error ? err.message : __('Error al mover el registro.'));
        } finally {
            setDraggingId(null);
        }
    };

    // Columnas dinámicas: además de las opciones predefinidas del campo (select/
    // multi_select), mostramos una columna por cada VALOR presente en los
    // registros que no esté en esas opciones. Así el Kanban también funciona
    // agrupando por un campo de texto/estado con valores ad-hoc (antes esos
    // registros se agrupaban pero su columna nunca se renderizaba → tablero
    // vacío), y no se "pierden" registros con un valor legacy fuera del catálogo.
    const knownValues = new Set(options.map((o) => o.value));
    const extraColumns = Array.from(grouped.keys())
        .filter((k) => k !== UNCATEGORIZED_KEY && !knownValues.has(k))
        .sort((a, b) => a.localeCompare(b))
        .map((k) => ({ key: k, label: k }));

    const allColumns: Array<{ key: string; label: string; color?: string }> = [
        ...options.map((o) => ({ key: o.value, label: o.label, color: o.color })),
        ...extraColumns,
        { key: UNCATEGORIZED_KEY, label: __('Sin asignar') },
    ];

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            {moveError !== null && (
                <div
                    role="alert"
                    className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive"
                >
                    <span>{moveError}</span>
                    <button
                        type="button"
                        onClick={() => setMoveError(null)}
                        className="imcrm-text-xs imcrm-underline"
                    >
                        {__('Cerrar')}
                    </button>
                </div>
            )}
            <div className="imcrm-flex imcrm-gap-3 imcrm-overflow-x-auto imcrm-pb-2">
            {allColumns.map((col) => {
                const colRecords = grouped.get(col.key) ?? [];
                // Contador real del servidor (si todavía no llegó, lo cargado).
                const colCount = Math.max(serverCounts.get(col.key) ?? 0, colRecords.length);
                const isTarget = dropTarget === col.key;
                const colSolid = colorVar(col.color as OptionColor | undefined);
                const colTint =
                    colSolid !== undefined
                        ? `color-mix(in srgb, ${colSolid} 8%, hsl(var(--imcrm-card)))`
                        : undefined;
                return (
                    <div
                        key={col.key}
                        className={cn(
                            'imcrm-flex imcrm-w-80 imcrm-shrink-0 imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-transition-all imcrm-duration-150',
                            isTarget
                                ? 'imcrm-border-primary/60 imcrm-ring-2 imcrm-ring-primary/20'
                                : 'imcrm-border-border/60',
                            colTint === undefined && 'imcrm-bg-muted/30',
                        )}
                        // v0.1.125 — la columna se identifica por COLOR: el de la
                        // opción del campo por el que agrupa (una sola fuente de
                        // verdad, se edita en el catálogo del campo). Velo suave
                        // en el fondo + franja del color arriba.
                        style={
                            colTint !== undefined && !isTarget
                                ? { backgroundColor: colTint, borderTopColor: colSolid, borderTopWidth: 3 }
                                : undefined
                        }
                        onDragOver={(e) => {
                            if (draggingId !== null) {
                                e.preventDefault();
                                if (dropTarget !== col.key) setDropTarget(col.key);
                            }
                        }}
                        onDragLeave={() => {
                            if (dropTarget === col.key) setDropTarget(null);
                        }}
                        onDrop={() => void handleDrop(col.key)}
                    >
                        <header className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border/40 imcrm-px-3 imcrm-py-2.5">
                            <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2">
                                {/* Etiqueta SÓLIDA con el color de la opción — el
                                    mismo chip que la tabla y el Kanban usan para
                                    ese valor, así la columna se reconoce de un
                                    vistazo. Sin color: chip neutro. */}
                                <span
                                    className={cn(
                                        'imcrm-truncate imcrm-rounded imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-bold imcrm-uppercase imcrm-tracking-wider',
                                        col.color === undefined &&
                                            'imcrm-bg-muted imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-border',
                                    )}
                                    style={chipSoftStyle(col.color as OptionColor | undefined)}
                                >
                                    {col.label}
                                </span>
                                <span className="imcrm-shrink-0 imcrm-rounded-full imcrm-bg-card imcrm-px-2 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-semibold imcrm-text-muted-foreground imcrm-shadow-imcrm-sm">
                                    {colCount}
                                </span>
                            </div>
                        </header>

                        <div className="imcrm-flex imcrm-min-h-[80px] imcrm-flex-col imcrm-gap-2 imcrm-p-2">
                            {colRecords.length === 0 ? (
                                <div className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-border-2 imcrm-border-dashed imcrm-border-border/50 imcrm-py-8 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground/70">
                                    {__('Arrastra una tarjeta aquí')}
                                </div>
                            ) : (
                                colRecords.map((record) => (
                                    <KanbanCard
                                        key={record.id}
                                        record={record}
                                        titleField={titleField}
                                        metaFields={metaFields}
                                        columnColor={col.color}
                                        isDragging={draggingId === record.id}
                                        onDragStart={() => setDraggingId(record.id)}
                                        onDragEnd={() => {
                                            setDraggingId(null);
                                            setDropTarget(null);
                                        }}
                                        onClick={() => onCardClick(record)}
                                        moveTargets={allColumns.filter((c) => c.key !== col.key)}
                                        onMove={(target) => void moveRecord(record.id, target)}
                                    />
                                ))
                            )}
                            {colCount > colRecords.length && (
                                <p className="imcrm-px-1 imcrm-text-center imcrm-text-[11px] imcrm-text-muted-foreground">
                                    {sprintf(
                                        /* translators: 1: cards shown, 2: records in the column */
                                        __('Se muestran %1$d de %2$d — usa filtros para acotar.'),
                                        colRecords.length,
                                        colCount,
                                    )}
                                </p>
                            )}
                        </div>
                    </div>
                );
            })}
            </div>
        </div>
    );
}

interface KanbanCardProps {
    record: RecordEntity;
    titleField?: FieldEntity;
    metaFields: FieldEntity[];
    columnColor?: string;
    isDragging: boolean;
    onDragStart: () => void;
    onDragEnd: () => void;
    onClick: () => void;
    /** Columnas a las que se puede mover la tarjeta (todas menos la suya). */
    moveTargets: Array<{ key: string; label: string; color?: string }>;
    onMove: (targetKey: string) => void;
}

function KanbanCard({
    record,
    titleField,
    metaFields,
    columnColor,
    isDragging,
    onDragStart,
    onDragEnd,
    onClick,
    moveTargets,
    onMove,
}: KanbanCardProps): JSX.Element {
    const titleValue = titleField ? record.fields[titleField.slug] : undefined;
    const title =
        typeof titleValue === 'string' && titleValue !== ''
            ? titleValue
            : sprintf(
                  /* translators: %d: record id */
                  __('Registro #%d'),
                  record.id,
              );

    return (
        <article
            draggable
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onClick={onClick}
            className={cn(
                'imcrm-group imcrm-relative imcrm-cursor-pointer imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-sm imcrm-transition-all imcrm-duration-150',
                'hover:imcrm-shadow-imcrm-md hover:imcrm--translate-y-0.5 hover:imcrm-border-primary/40',
                isDragging && 'imcrm-opacity-50 imcrm-rotate-1 imcrm-shadow-imcrm-lg',
            )}
        >
            {columnColor !== undefined && (
                <span
                    aria-hidden
                    className="imcrm-absolute imcrm-left-0 imcrm-top-0 imcrm-h-full imcrm-w-1"
                    style={{
                        backgroundColor:
                            colorVar(columnColor as OptionColor) ?? columnColor,
                    }}
                />
            )}

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-p-3 imcrm-pl-3.5">
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2">
                    <GripVertical
                        className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground/50 imcrm-opacity-0 imcrm-transition-opacity group-hover:imcrm-opacity-100"
                        aria-hidden
                    />
                    <h4 className="imcrm-line-clamp-2 imcrm-flex-1 imcrm-text-sm imcrm-font-semibold imcrm-leading-snug imcrm-text-foreground">
                        {String(title)}
                    </h4>
                    {moveTargets.length > 0 && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    onClick={(e) => e.stopPropagation()}
                                    aria-label={sprintf(__('Mover «%s» a otra columna'), String(title))}
                                    className="imcrm--mr-1 imcrm--mt-0.5 imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground imcrm-opacity-60 hover:imcrm-bg-accent hover:imcrm-text-foreground group-hover:imcrm-opacity-100 [@media(hover:hover)]:imcrm-opacity-0 [@media(hover:hover)]:group-hover:imcrm-opacity-100 focus-visible:imcrm-opacity-100"
                                    data-testid="imcrm-kanban-card-menu"
                                >
                                    <MoreHorizontal className="imcrm-h-4 imcrm-w-4" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                align="end"
                                className="imcrm-max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] imcrm-overflow-y-auto"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <DropdownMenuLabel className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                    <ArrowRightLeft className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Mover a…')}
                                </DropdownMenuLabel>
                                {moveTargets.map((t) => (
                                    <DropdownMenuItem key={t.key} onSelect={() => onMove(t.key)}>
                                        <span
                                            aria-hidden
                                            className="imcrm-h-2 imcrm-w-2 imcrm-shrink-0 imcrm-rounded-full"
                                            style={{ backgroundColor: colorVar(t.color as OptionColor | undefined) ?? 'hsl(var(--imcrm-muted-foreground) / 0.4)' }}
                                        />
                                        {t.label}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>

                {metaFields.length > 0 && (
                    <dl className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        {metaFields.map((field) => {
                            const v = record.fields[field.slug];
                            if (v === undefined || v === null || v === '') return null;
                            return (
                                <div
                                    key={field.id}
                                    className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs"
                                >
                                    <dt className="imcrm-shrink-0 imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground/70">
                                        {field.label}
                                    </dt>
                                    <dd className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-foreground">
                                        {renderCellValue(field, v)}
                                    </dd>
                                </div>
                            );
                        })}
                    </dl>
                )}
            </div>
        </article>
    );
}

function pickTitleField(fields: FieldEntity[], excludeId: number): FieldEntity | undefined {
    const primary = fields.find((f) => f.is_primary);
    if (primary) return primary;
    return fields.find((f) => f.id !== excludeId && (f.type === 'text' || f.type === 'email'));
}

function pickMetaFields(
    fields: FieldEntity[],
    excludeGroupBy: number,
    excludeTitle: number | undefined,
): FieldEntity[] {
    return fields
        .filter(
            (f) =>
                f.id !== excludeGroupBy &&
                f.id !== excludeTitle &&
                f.type !== 'long_text' &&
                f.type !== 'file' &&
                f.type !== 'relation',
        )
        .slice(0, 3);
}

