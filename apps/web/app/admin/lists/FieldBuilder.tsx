import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import {
    Columns3,
    GripVertical,
    Hash,
    Heading1,
    KeyRound,
    Layers,
    List as ListIcon,
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
import { useToast } from '@/components/ui/toast';
import { fieldsKeys, useCreateField, useDeleteField, useFields, useReorderFields } from '@/hooks/useFields';
import { useFieldTypes } from '@/hooks/useFieldTypes';
import { useList, useLists, useUpdateList } from '@/hooks/useLists';
import { invalidateForList } from '@/hooks/useRecords';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { formatDateStr } from '@/lib/tenantFormat';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity, FieldTypeSlug } from '@/types/field';

import { FieldDialog } from './FieldDialog';
import { FieldSettingsPanel } from './FieldSettingsPanel';

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
 * Administrador de campos de la lista (Ajustes → Campos).
 *
 * v0.1.163 — Reescrito como interfaz de TRES COLUMNAS, el
 * "Administrador de campos personalizados" de ClickUp (pedido del usuario:
 * "es una interfaz multi columna con varias opciones"):
 *
 *   - **Izquierda**: navegación — todos los campos, por tipo (con contador)
 *     y las otras listas del workspace (el administrador de una lista se
 *     alcanza desde el de otra, sin volver al menú).
 *   - **Centro**: tabla agrupada por tipo con su chip, contador, columnas
 *     alineadas (Nombre · Propiedades · Creado), menú por fila y una fila
 *     "+ Crear campo de <tipo>" en cada grupo.
 *   - **Derecha**: los ajustes del campo seleccionado, con TODAS sus
 *     opciones (nombre, descripción, tipo, nombre interno, config del tipo,
 *     obligatorio / sin repetidos / indexar / título, y qué roles no lo ven).
 *
 * El orden de los campos sigue siendo arrastrable, pero sólo en la vista
 * plana (con un filtro puesto, soltar una fila entre otras dos no describe
 * una posición real).
 */
export function FieldBuilder({ listId }: FieldBuilderProps): JSX.Element {
    const qc = useQueryClient();
    const navigate = useNavigate();
    const list = useList(listId);
    const listData = list.data;
    const lists = useLists();
    const fields = useFields(listId);
    const types = useFieldTypes();
    const createField = useCreateField(listId);
    const deleteField = useDeleteField(listId);
    const reorder = useReorderFields(listId);
    const updateList = useUpdateList(listId);
    const confirm = useConfirm();
    const toast = useToast();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingField, setEditingField] = useState<FieldEntity | null>(null);
    const [search, setSearch] = useState('');
    /** Navegación de la izquierda: '' = todos; si no, un tipo. */
    const [typeFilter, setTypeFilter] = useState<string>('');
    const [selectedId, setSelectedId] = useState<number | null>(null);
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

    /** Tipos presentes en la lista con su contador, para la navegación. */
    const typeCounts = useMemo(() => {
        const map = new Map<string, number>();
        for (const f of all) map.set(f.type, (map.get(f.type) ?? 0) + 1);
        return [...map.entries()];
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

    const selected = selectedId !== null ? all.find((f) => f.id === selectedId) ?? null : null;

    // Reordenar sólo tiene sentido sobre la lista COMPLETA: con un filtro
    // activo, soltar una fila entre otras dos no describe una posición real.
    const canReorder = term === '' && typeFilter === '' && all.length > 1;

    const openCreate = (): void => {
        setEditingField(null);
        setDialogOpen(true);
    };

    /** "+ Crear campo de <tipo>": alta directa con el tipo del grupo. */
    const createOfType = async (type: FieldTypeSlug): Promise<void> => {
        const label = sprintf(
            /* translators: %s: nombre del tipo de campo */
            __('%s nuevo'),
            typeLabels.get(type) ?? type,
        );
        try {
            const created = await createField.mutateAsync({ label, type });
            setSelectedId(created.id);
            toast.success(__('Campo creado'), label);
        } catch (err) {
            toast.error(
                __('No se pudo crear el campo'),
                err instanceof Error ? err.message : undefined,
            );
        }
    };

    // `?field=<id>` selecciona ese campo — es como el panel de campos y el
    // menú de la columna mandan a "ajustes avanzados" sin perder de vista
    // cuál era.
    const requestedFieldId = Number(params.get('field') ?? '');
    useEffect(() => {
        if (!Number.isInteger(requestedFieldId) || requestedFieldId <= 0) return;
        const target = all.find((f) => f.id === requestedFieldId);
        if (!target) return;
        setSelectedId(target.id);
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

    const handleDuplicate = async (field: FieldEntity): Promise<void> => {
        try {
            await createField.mutateAsync({
                label: sprintf(
                    /* translators: %s: label del campo original */
                    __('%s (copia)'),
                    field.label,
                ),
                type: field.type,
                config: field.config,
                is_required: field.is_required,
                description: field.description ?? null,
            });
            toast.success(__('Campo duplicado'));
        } catch (err) {
            toast.error(
                __('No se pudo duplicar el campo'),
                err instanceof Error ? err.message : undefined,
            );
        }
    };

    const handleCopyId = async (field: FieldEntity): Promise<void> => {
        try {
            await navigator.clipboard.writeText(String(field.id));
            toast.success(__('ID de campo copiado'), `#${field.id}`);
        } catch {
            toast.error(__('No se pudo copiar al portapapeles'));
        }
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
        if (selectedId === field.id) setSelectedId(null);
        deleteField.mutate({ id: field.id, purge: false });
    };

    const requiredCount = all.filter((f) => f.is_required).length;
    const indexedCount = all.filter((f) => f.is_indexed).length;
    const otherLists = (lists.data ?? []).filter((l) => l.id !== listId);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
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
                <Button onClick={openCreate} className="imcrm-gap-2">
                    <Plus className="imcrm-h-4 imcrm-w-4" />
                    {__('Nuevo campo')}
                </Button>
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

            {all.length > 0 && (
                <div className="imcrm-flex imcrm-items-start imcrm-gap-4">
                    {/* ── Columna 1: navegación ───────────────────────── */}
                    <nav className="imcrm-hidden imcrm-w-52 imcrm-shrink-0 imcrm-flex-col imcrm-gap-4 lg:imcrm-flex">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                            <NavItem
                                active={typeFilter === ''}
                                onClick={() => setTypeFilter('')}
                                icon={Layers}
                                label={__('Todos los campos')}
                                count={all.length}
                            />
                            <p className="imcrm-px-2 imcrm-pt-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                                {requiredCount > 0 && sprintf(
                                    /* translators: %d: cantidad de campos obligatorios */
                                    __('%d obligatorios'),
                                    requiredCount,
                                )}
                                {requiredCount > 0 && indexedCount > 0 && ' · '}
                                {indexedCount > 0 && sprintf(
                                    /* translators: %d: cantidad de campos indexados */
                                    __('%d indexados'),
                                    indexedCount,
                                )}
                            </p>
                        </div>

                        <NavSection title={__('Por tipo')}>
                            {typeCounts.map(([type, count]) => (
                                <NavItem
                                    key={type}
                                    active={typeFilter === type}
                                    onClick={() => setTypeFilter(type)}
                                    icon={fieldTypeIcon(type)}
                                    label={typeLabels.get(type) ?? type}
                                    count={count}
                                />
                            ))}
                        </NavSection>

                        {otherLists.length > 0 && (
                            <NavSection title={__('Otras listas')}>
                                {otherLists.slice(0, 12).map((l) => (
                                    <NavItem
                                        key={l.id}
                                        active={false}
                                        onClick={() => navigate(`/lists/${l.slug}/edit?s=campos`)}
                                        icon={ListIcon}
                                        label={l.name}
                                    />
                                ))}
                            </NavSection>
                        )}
                    </nav>

                    {/* ── Columna 2: la tabla, agrupada por tipo ──────── */}
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-3">
                        {visible.length === 0 ? (
                            <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Ningún campo coincide con la búsqueda.')}
                            </p>
                        ) : (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                                <FieldsTableHeader />
                                {groups.map(([type, rows]) => {
                                    const GroupIcon = fieldTypeIcon(type);
                                    return (
                                        <div key={type} className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                            <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-muted imcrm-px-2 imcrm-py-0.5 imcrm-text-xs imcrm-font-medium imcrm-text-foreground imcrm-ring-1 imcrm-ring-inset imcrm-ring-border">
                                                    <GroupIcon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                                                    {typeLabels.get(type) ?? type}
                                                </span>
                                                <span className="imcrm-text-xs imcrm-text-muted-foreground">{rows.length}</span>
                                            </p>
                                            <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
                                                {rows.map((field) => (
                                                    <FieldRow
                                                        key={field.id}
                                                        field={field}
                                                        selected={selectedId === field.id}
                                                        draggable={canReorder}
                                                        onDragStart={() => {
                                                            dragIndexRef.current = all.findIndex((f) => f.id === field.id);
                                                        }}
                                                        onDragOver={(e) => {
                                                            if (canReorder) e.preventDefault();
                                                        }}
                                                        onDrop={(e) => {
                                                            e.preventDefault();
                                                            handleDrop(all.findIndex((f) => f.id === field.id));
                                                        }}
                                                        onSelect={() => setSelectedId(field.id)}
                                                        onRename={() => {
                                                            setEditingField(field);
                                                            setDialogOpen(true);
                                                        }}
                                                        onDuplicate={() => void handleDuplicate(field)}
                                                        onCopyId={() => void handleCopyId(field)}
                                                        onDelete={() => void handleDelete(field)}
                                                        onMakeTitle={
                                                            canBeTitle(field) && !field.is_primary
                                                                ? () => makeTitle(field)
                                                                : undefined
                                                        }
                                                    />
                                                ))}
                                                <li>
                                                    <button
                                                        type="button"
                                                        disabled={createField.isPending}
                                                        onClick={() => void createOfType(type as FieldTypeSlug)}
                                                        className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-1.5 imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-accent/40 hover:imcrm-text-foreground"
                                                    >
                                                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                                        {sprintf(
                                                            /* translators: %s: nombre del tipo de campo */
                                                            __('Crear campo de %s'),
                                                            (typeLabels.get(type) ?? type).toLowerCase(),
                                                        )}
                                                    </button>
                                                </li>
                                            </ul>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {canReorder && (
                            <p className="imcrm-pt-2 imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Arrastrá un campo por el asa de la izquierda para cambiar su orden.')}
                            </p>
                        )}
                    </div>

                    {/* ── Columna 3: ajustes del campo elegido ────────── */}
                    <div className="imcrm-hidden imcrm-w-[340px] imcrm-shrink-0 xl:imcrm-block">
                        {selected ? (
                            <FieldSettingsPanel
                                key={selected.id}
                                listId={listId}
                                field={selected}
                                onDelete={() => void handleDelete(selected)}
                                onMakeTitle={
                                    canBeTitle(selected) && !selected.is_primary
                                        ? () => makeTitle(selected)
                                        : undefined
                                }
                            />
                        ) : (
                            <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-8 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Elegí un campo de la lista para ver y cambiar todos sus ajustes.')}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <FieldDialog
                listId={listId}
                field={editingField}
                open={dialogOpen}
                onOpenChange={setDialogOpen}
            />
        </div>
    );
}

function NavSection({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
            <p className="imcrm-px-2 imcrm-pb-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                {title}
            </p>
            {children}
        </div>
    );
}

function NavItem({
    active,
    onClick,
    icon: Icon,
    label,
    count,
}: {
    active: boolean;
    onClick: () => void;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    count?: number;
}): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm',
                active
                    ? 'imcrm-bg-accent imcrm-font-medium imcrm-text-foreground'
                    : 'imcrm-text-muted-foreground hover:imcrm-bg-accent/50 hover:imcrm-text-foreground',
            )}
        >
            <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
            <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{label}</span>
            {count !== undefined && (
                <span className="imcrm-shrink-0 imcrm-text-xs imcrm-tabular-nums imcrm-text-muted-foreground">
                    {count}
                </span>
            )}
        </button>
    );
}

/**
 * v0.1.161 — grilla de COLUMNAS alineadas, como el administrador de campos
 * de ClickUp: con 15 campos, una lista de tarjetas no deja comparar nada.
 * Las mismas columnas que el encabezado — de ahí que compartan `FIELD_GRID`.
 */
const FIELD_GRID = cn(
    'imcrm-grid imcrm-items-center imcrm-gap-2',
    // Las columnas de detalle sólo aparecen cuando hay ancho para ellas: con
    // el panel de ajustes abierto en pantallas medianas, forzarlas hacía que
    // los textos se pisaran entre sí.
    'imcrm-grid-cols-[20px_minmax(0,1fr)_36px]',
    '[@media(min-width:1100px)]:imcrm-grid-cols-[20px_minmax(0,1fr)_150px_36px]',
    '[@media(min-width:1320px)]:imcrm-grid-cols-[20px_minmax(0,1fr)_150px_100px_36px]',
);
/** Celdas que sólo se muestran a partir de cierto ancho. */
const CELL_PROPS = 'imcrm-hidden [@media(min-width:1100px)]:imcrm-flex';
const CELL_CREATED = 'imcrm-hidden [@media(min-width:1320px)]:imcrm-block';

function FieldsTableHeader(): JSX.Element {
    return (
        <div
            className={cn(
                FIELD_GRID,
                'imcrm-px-2 imcrm-pb-1',
                'imcrm-text-[11px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground',
            )}
        >
            <span aria-hidden />
            <span>{__('Nombre')}</span>
            <span className={CELL_PROPS}>{__('Propiedades')}</span>
            <span className={CELL_CREATED}>{__('Creado')}</span>
            <span aria-hidden />
        </div>
    );
}

interface FieldRowProps {
    field: FieldEntity;
    selected: boolean;
    draggable: boolean;
    onDragStart: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    onSelect: () => void;
    onRename: () => void;
    onDuplicate: () => void;
    onCopyId: () => void;
    onDelete: () => void;
    onMakeTitle?: () => void;
}

function FieldRow({
    field,
    selected,
    draggable,
    onDragStart,
    onDragOver,
    onDrop,
    onSelect,
    onRename,
    onDuplicate,
    onCopyId,
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
            className={cn(
                FIELD_GRID,
                'imcrm-group imcrm-px-2 imcrm-py-1.5',
                selected ? 'imcrm-bg-accent/60' : 'hover:imcrm-bg-accent/30',
            )}
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

            {/* La fila entera selecciona el campo: sus ajustes aparecen en la
                columna de la derecha, sin sacar la tabla de la vista. */}
            <button
                type="button"
                onClick={onSelect}
                className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5 imcrm-rounded-md imcrm-px-1 imcrm-py-1 imcrm-text-left focus:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary"
            >
                <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2">
                    <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                    <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{field.label}</span>
                    {field.is_primary && (
                        <Badge variant="secondary" className="imcrm-shrink-0 imcrm-gap-1">
                            <KeyRound className="imcrm-h-3 imcrm-w-3" />
                            {__('Título')}
                        </Badge>
                    )}
                </span>
                {field.description !== null && field.description !== undefined && field.description !== '' && (
                    <span className="imcrm-truncate imcrm-pl-6 imcrm-text-xs imcrm-text-muted-foreground">
                        {field.description}
                    </span>
                )}
            </button>

            <span className={cn(CELL_PROPS, 'imcrm-flex-wrap imcrm-gap-1')}>
                {field.is_required && <Badge variant="outline">{__('Obligatorio')}</Badge>}
                {field.is_unique && <Badge variant="outline">{__('Sin repetidos')}</Badge>}
                {field.is_indexed && <Badge variant="outline">{__('Indexado')}</Badge>}
            </span>

            <span className={cn(CELL_CREATED, 'imcrm-truncate imcrm-text-xs imcrm-tabular-nums imcrm-text-muted-foreground')}>
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
                    <DropdownMenuItem onSelect={onSelect}>
                        <Pencil className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Modificar')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={onRename}>
                        <Pencil className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Cambiar el nombre')}
                    </DropdownMenuItem>
                    {onMakeTitle && (
                        <DropdownMenuItem onSelect={onMakeTitle}>
                            <Heading1 className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {__('Usar como título')}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem onSelect={onDuplicate}>
                        <Columns3 className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Duplicar')}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={onCopyId}>
                        <Hash className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Copiar ID de campo')}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem danger onSelect={onDelete}>
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Eliminar de esta lista')}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
        </li>
    );
}
