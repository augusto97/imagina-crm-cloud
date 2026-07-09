import { useMemo, useState } from 'react';
import { GripVertical } from 'lucide-react';

import { renderCellValue } from '@/admin/records/renderCellValue';
import { colorVar, type OptionColor } from '@/components/ui/color-picker';
import { useUpdateRecord } from '@/hooks/useRecords';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

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
}: KanbanViewProps): JSX.Element {
    const update = useUpdateRecord(listId);
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

        const record = records.find((r) => r.id === draggingId);
        if (!record) {
            setDraggingId(null);
            return;
        }

        const currentValue = record.fields[groupByField.slug];
        const newValue = targetValue === UNCATEGORIZED_KEY ? null : targetValue;
        if (currentValue === newValue) {
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
                const isTarget = dropTarget === col.key;
                return (
                    <div
                        key={col.key}
                        className={cn(
                            'imcrm-flex imcrm-w-80 imcrm-shrink-0 imcrm-flex-col imcrm-rounded-xl imcrm-border imcrm-bg-muted/30 imcrm-transition-all imcrm-duration-150',
                            isTarget
                                ? 'imcrm-border-primary/60 imcrm-bg-primary/5 imcrm-ring-2 imcrm-ring-primary/20'
                                : 'imcrm-border-border/60',
                        )}
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
                                <span
                                    className="imcrm-h-2.5 imcrm-w-2.5 imcrm-shrink-0 imcrm-rounded-full"
                                    style={{
                                        backgroundColor:
                                            colorVar(col.color as OptionColor | undefined) ??
                                            'hsl(var(--imcrm-muted-foreground))',
                                    }}
                                    aria-hidden
                                />
                                <h3 className="imcrm-truncate imcrm-text-xs imcrm-font-bold imcrm-uppercase imcrm-tracking-wider imcrm-text-foreground">
                                    {col.label}
                                </h3>
                                <span className="imcrm-shrink-0 imcrm-rounded-full imcrm-bg-card imcrm-px-2 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-semibold imcrm-text-muted-foreground imcrm-shadow-imcrm-sm">
                                    {colRecords.length}
                                </span>
                            </div>
                        </header>

                        <div className="imcrm-flex imcrm-min-h-[80px] imcrm-flex-col imcrm-gap-2 imcrm-p-2">
                            {colRecords.length === 0 ? (
                                <div className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-border-2 imcrm-border-dashed imcrm-border-border/50 imcrm-py-8 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground/70">
                                    {__('Arrastra una card aquí')}
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
                                    />
                                ))
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

