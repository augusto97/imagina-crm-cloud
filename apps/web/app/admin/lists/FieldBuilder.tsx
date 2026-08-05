import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
    Columns3,
    GripVertical,
    Hash,
    Heading1,
    KeyRound,
    Loader2,
    MoreHorizontal,
    Pencil,
    Plus,
    Search,
    Trash2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { fieldsKeys, useDeleteField, useFields, useReorderFields } from '@/hooks/useFields';
import { useFieldTypes } from '@/hooks/useFieldTypes';
import { useList, useUpdateList } from '@/hooks/useLists';
import { invalidateForList } from '@/hooks/useRecords';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { formatDateStr } from '@/lib/tenantFormat';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { FieldDialog } from './FieldDialog';

interface FieldBuilderProps {
    listId: number;
}

/**
 * v0.1.136 — Sólo un campo de TEXTO puede hacer de título del registro:
 * el título es una línea, no un monto ni una fecha.
 */
function canBeTitle(field: FieldEntity): boolean {
    return field.type === 'text' || field.type === 'long_text';
}

/**
 * Sección "Campos" de la configuración de la lista.
 *
 * Rediseñada en v0.1.126: cada campo es una fila con el icono de su
 * tipo, el nombre y el tipo en lenguaje humano (antes: el slug en
 * monospace y el tipo EN MAYÚSCULAS, más el nombre de la columna
 * interna — jerga que no le decía nada a nadie). Se puede buscar
 * cuando hay muchos y ARRASTRAR para reordenar: el orden de esta
 * lista es el orden en que los campos aparecen en la ficha y en el
 * formulario de alta.
 */
export function FieldBuilder({ listId }: FieldBuilderProps): JSX.Element {
    const qc = useQueryClient();
    const list = useList(listId);
    const listData = list.data;
    const fields = useFields(listId);
    const types = useFieldTypes();
    const deleteField = useDeleteField(listId);
    const reorder = useReorderFields(listId);
    const updateList = useUpdateList(listId);
    const confirm = useConfirm();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingField, setEditingField] = useState<FieldEntity | null>(null);
    const [search, setSearch] = useState('');
    // v0.1.160 — el administrador de campos: filtro por tipo y agrupado por
    // tipo, como el "Administrador de campos personalizados" de ClickUp.
    const [typeFilter, setTypeFilter] = useState<string>('');
    const [groupByType, setGroupByType] = useState(false);
    const dragIndexRef = useRef<number | null>(null);
    const [params, setParams] = useSearchParams();

    const typeLabels = useMemo(() => {
        const map = new Map<string, string>();
        for (const t of types.data ?? []) map.set(t.slug, t.label);
        return map;
    }, [types.data]);

    const all = fields.data ?? [];
    const term = search.trim().toLowerCase();
    const visible = all.filter((f) => {
        if (typeFilter !== '' && f.type !== typeFilter) return false;
        if (term === '') return true;
        return f.label.toLowerCase().includes(term) || f.slug.toLowerCase().includes(term);
    });

    const requiredCount = all.filter((f) => f.is_required).length;
    const indexedCount = all.filter((f) => f.is_indexed).length;

    /** Tipos presentes en la lista, para poblar el filtro. */
    const typesPresent = useMemo(() => {
        const seen = new Set<string>();
        for (const f of all) seen.add(f.type);
        return [...seen];
    }, [all]);

    /** Filas agrupadas por tipo (el orden de los grupos es el de aparición). */
    const groups = useMemo(() => {
        const map = new Map<string, FieldEntity[]>();
        for (const f of visible) {
            const arr = map.get(f.type);
            if (arr) arr.push(f);
            else map.set(f.type, [f]);
        }
        return [...map.entries()];
    }, [visible]);

    // Reordenar sólo tiene sentido sobre la lista COMPLETA: con un
    // filtro activo, soltar una fila entre otras dos no describe una
    // posición real.
    const canReorder = term === '' && typeFilter === '' && !groupByType && all.length > 1;

    const openCreate = (): void => {
        setEditingField(null);
        setDialogOpen(true);
    };
    const openEdit = (field: FieldEntity): void => {
        setEditingField(field);
        setDialogOpen(true);
    };

    // `?field=<id>` abre ese campo — es como el panel de campos y el menú de
    // la columna mandan a "ajustes avanzados" sin perder de vista cuál era.
    const requestedFieldId = Number(params.get('field') ?? '');
    useEffect(() => {
        if (!Number.isInteger(requestedFieldId) || requestedFieldId <= 0) return;
        const target = (fields.data ?? []).find((f) => f.id === requestedFieldId);
        if (!target) return;
        setEditingField(target);
        setDialogOpen(true);
        const next = new URLSearchParams(params);
        next.delete('field');
        setParams(next, { replace: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [requestedFieldId, fields.data]);

    const handleDrop = (targetIndex: number): void => {
        const from = dragIndexRef.current;
        dragIndexRef.current = null;
        if (from === null || from === targetIndex) return;
        const next = [...all];
        const [moved] = next.splice(from, 1);
        if (!moved) return;
        next.splice(targetIndex, 0, moved);
        reorder.mutate(next.map((f) => f.id));
    };

    /**
     * v0.1.136 — Elegir el campo que hace de TÍTULO del registro. No es una
     * propiedad del campo: vive en `settings.title_field_id` de la lista
     * (una lista tiene un solo título), así que se guarda con el PATCH de la
     * lista y hay que refrescar los campos (el backend deriva `is_primary`).
     */
    const makeTitle = (field: FieldEntity): void => {
        updateList.mutate(
            { settings: { ...(listData?.settings ?? {}), title_field_id: field.id } },
            { onSuccess: () => invalidateForList(qc, fieldsKeys.all, listId) },
        );
    };

    const handleDelete = async (field: FieldEntity): Promise<void> => {
        const ok = await confirm({
            title: sprintf(
                /* translators: %s: field label */
                __('¿Eliminar el campo "%s"?'),
                field.label,
            ),
            description: __(
                'Deja de aparecer en la tabla, la ficha y los formularios. Lo que ya estaba cargado en ese campo se conserva.',
            ),
            confirmLabel: __('Eliminar campo'),
            destructive: true,
        });
        if (!ok) return;
        deleteField.mutate({ id: field.id, purge: false });
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            {/* Resumen de la lista de campos (v0.1.161): con 15 campos, saber
                de una cuántos hay y cuántos se están viendo con el filtro
                puesto es la diferencia entre un administrador y una lista. */}
            {all.length > 0 && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {visible.length === all.length
                        ? sprintf(
                            /* translators: %d: cantidad de campos */
                            __('%d campos'),
                            all.length,
                        )
                        : sprintf(
                            /* translators: 1: campos visibles, 2: total */
                            __('%1$d de %2$d campos'),
                            visible.length,
                            all.length,
                        )}
                    {requiredCount > 0
                        && ` · ${sprintf(
                            /* translators: %d: cantidad de campos obligatorios */
                            __('%d obligatorios'),
                            requiredCount,
                        )}`}
                    {indexedCount > 0
                        && ` · ${sprintf(
                            /* translators: %d: cantidad de campos indexados */
                            __('%d indexados'),
                            indexedCount,
                        )}`}
                </p>
            )}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-relative imcrm-min-w-[180px] imcrm-flex-1 sm:imcrm-max-w-xs">
                    <Search
                        className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-1/2 imcrm-h-3.5 imcrm-w-3.5 imcrm--translate-y-1/2 imcrm-text-muted-foreground"
                        aria-hidden
                    />
                    <Input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={__('Buscar un campo…')}
                        aria-label={__('Buscar un campo')}
                        className="imcrm-h-9 imcrm-pl-8"
                    />
                </div>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                    {typesPresent.length > 1 && (
                        <>
                            <Select
                                value={typeFilter}
                                onChange={(e) => setTypeFilter(e.target.value)}
                                aria-label={__('Filtrar por tipo')}
                                className="imcrm-h-9 imcrm-w-auto imcrm-text-sm"
                            >
                                <option value="">{__('Todos los tipos')}</option>
                                {typesPresent.map((t) => (
                                    <option key={t} value={t}>
                                        {typeLabels.get(t) ?? t}
                                    </option>
                                ))}
                            </Select>
                            <label className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-text-muted-foreground">
                                <input
                                    type="checkbox"
                                    checked={groupByType}
                                    onChange={(e) => setGroupByType(e.target.checked)}
                                />
                                {__('Agrupar por tipo')}
                            </label>
                        </>
                    )}
                    <Button onClick={openCreate} className="imcrm-gap-2">
                        <Plus className="imcrm-h-4 imcrm-w-4" />
                        {__('Nuevo campo')}
                    </Button>
                </div>
            </div>

            {fields.isLoading && (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-6 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando campos…')}
                </div>
            )}

            {fields.data && all.length === 0 && (
                <EmptyState
                    icon={Columns3}
                    title={__('Todavía no hay campos')}
                    description={__(
                        'Los campos definen qué información guarda cada registro: un nombre, un teléfono, una fecha, un estado…',
                    )}
                    action={
                        <Button onClick={openCreate} className="imcrm-gap-2">
                            <Plus className="imcrm-h-4 imcrm-w-4" />
                            {__('Crear el primer campo')}
                        </Button>
                    }
                />
            )}

            {all.length > 0 && visible.length === 0 && (
                <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Ningún campo coincide con la búsqueda.')}
                </p>
            )}

            {visible.length > 0 && groupByType && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    {groups.map(([type, rows]) => (
                        <div key={type} className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                            <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-muted imcrm-px-2 imcrm-py-0.5 imcrm-text-xs imcrm-font-medium imcrm-text-foreground imcrm-ring-1 imcrm-ring-inset imcrm-ring-border">
                                    {(() => {
                                        const GroupIcon = fieldTypeIcon(type);
                                        return <GroupIcon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />;
                                    })()}
                                    {typeLabels.get(type) ?? type}
                                </span>
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">{rows.length}</span>
                            </p>
                            <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
                                <li>
                                    <FieldsTableHeader />
                                </li>
                                {rows.map((field) => (
                                    <FieldRow
                                        key={field.id}
                                        field={field}
                                        typeLabel={typeLabels.get(field.type) ?? field.type}
                                        draggable={false}
                                        onDragStart={() => undefined}
                                        onDragOver={() => undefined}
                                        onDrop={() => undefined}
                                        onEdit={() => openEdit(field)}
                                        onDelete={() => void handleDelete(field)}
                                        onMakeTitle={
                                            canBeTitle(field) && !field.is_primary
                                                ? () => makeTitle(field)
                                                : undefined
                                        }
                                    />
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            )}

            {visible.length > 0 && !groupByType && (
                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
                    <li>
                        <FieldsTableHeader />
                    </li>
                    {visible.map((field, i) => (
                        <FieldRow
                            key={field.id}
                            field={field}
                            typeLabel={typeLabels.get(field.type) ?? field.type}
                            draggable={canReorder}
                            onDragStart={() => {
                                dragIndexRef.current = i;
                            }}
                            onDragOver={(e) => {
                                if (canReorder) e.preventDefault();
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                handleDrop(i);
                            }}
                            onEdit={() => openEdit(field)}
                            onDelete={() => void handleDelete(field)}
                            onMakeTitle={
                                canBeTitle(field) && !field.is_primary
                                    ? () => makeTitle(field)
                                    : undefined
                            }
                        />
                    ))}
                </ul>
            )}

            {canReorder && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Arrastrá un campo por el asa de la izquierda para cambiar su orden.')}
                </p>
            )}

            <FieldDialog
                listId={listId}
                field={editingField}
                open={dialogOpen}
                onOpenChange={(open) => {
                    setDialogOpen(open);
                    if (!open) setEditingField(null);
                }}
            />
        </div>
    );
}

interface FieldRowProps {
    field: FieldEntity;
    typeLabel: string;
    draggable: boolean;
    onDragStart: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onEdit: () => void;
    onDelete: () => void;
    /** `undefined` cuando este campo no puede ser el título (o ya lo es). */
    onMakeTitle?: () => void;
}

/**
 * v0.1.161 — grilla de COLUMNAS alineadas (Nombre · Tipo · Propiedades ·
 * Creado), como el administrador de campos de ClickUp: con 15 campos, una
 * lista de tarjetas no deja comparar nada. Las mismas columnas que el
 * encabezado de abajo — de ahí que compartan `FIELD_GRID`.
 */
const FIELD_GRID = 'imcrm-grid imcrm-grid-cols-[20px_minmax(0,1fr)_150px_150px_110px_36px] imcrm-items-center imcrm-gap-2';

function FieldsTableHeader(): JSX.Element {
    return (
        <div
            className={cn(
                FIELD_GRID,
                'imcrm-border-b imcrm-border-border imcrm-bg-muted/40 imcrm-px-2 imcrm-py-1.5',
                'imcrm-text-[11px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground',
            )}
        >
            <span aria-hidden />
            <span>{__('Nombre')}</span>
            <span>{__('Tipo')}</span>
            <span>{__('Propiedades')}</span>
            <span>{__('Creado')}</span>
            <span aria-hidden />
        </div>
    );
}

function FieldRow({
    field,
    typeLabel,
    draggable,
    onDragStart,
    onDragOver,
    onDrop,
    onEdit,
    onDelete,
    onMakeTitle,
}: FieldRowProps): JSX.Element {
    const Icon = fieldTypeIcon(field.type);
    return (
        <li
            draggable={draggable}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            className={cn(FIELD_GRID, 'imcrm-group imcrm-px-2 imcrm-py-1.5 hover:imcrm-bg-accent/30')}
        >
            <span
                aria-hidden
                className={cn(
                    'imcrm-flex imcrm-h-6 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground/50',
                    draggable ? 'imcrm-cursor-grab' : 'imcrm-invisible',
                )}
            >
                <GripVertical className="imcrm-h-4 imcrm-w-4" />
            </span>

            {/* La fila entera abre la edición: es lo que el usuario intenta
                hacer el 95% de las veces. */}
            <button
                type="button"
                onClick={onEdit}
                className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-1 imcrm-py-1 imcrm-text-left focus:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary"
            >
                <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{field.label}</span>
                {field.is_primary && (
                    <Badge variant="secondary" className="imcrm-shrink-0 imcrm-gap-1">
                        <KeyRound className="imcrm-h-3 imcrm-w-3" />
                        {__('Título')}
                    </Badge>
                )}
            </button>

            <span className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{typeLabel}</span>

            <span className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                {field.is_required && <Badge variant="outline">{__('Obligatorio')}</Badge>}
                {field.is_unique && <Badge variant="outline">{__('Sin repetidos')}</Badge>}
                {field.is_indexed && <Badge variant="outline">{__('Indexado')}</Badge>}
            </span>

            <span className="imcrm-truncate imcrm-text-xs imcrm-tabular-nums imcrm-text-muted-foreground">
                {field.created_at ? formatDateStr(field.created_at.slice(0, 10)) : '—'}
            </span>

            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="imcrm-shrink-0 imcrm-text-muted-foreground"
                        aria-label={sprintf(
                            /* translators: %s: field label */
                            __('Acciones de %s'),
                            field.label,
                        )}
                    >
                        <MoreHorizontal className="imcrm-h-4 imcrm-w-4" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={onEdit}>
                        <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Modificar')}
                    </DropdownMenuItem>
                    {onMakeTitle && (
                        <DropdownMenuItem onSelect={onMakeTitle}>
                            <Heading1 className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Usar como título')}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                        onSelect={() => {
                            void navigator.clipboard.writeText(String(field.id));
                        }}
                    >
                        <Hash className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Copiar ID de campo')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem danger onSelect={onDelete}>
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Eliminar')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </li>
    );
}
