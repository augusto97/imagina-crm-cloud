import { useMemo, useRef, useState } from 'react';
import { Columns3, GripVertical, KeyRound, Loader2, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';

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
import { useDeleteField, useFields, useReorderFields } from '@/hooks/useFields';
import { useFieldTypes } from '@/hooks/useFieldTypes';
import { fieldTypeIcon } from '@/lib/fieldTypeIcons';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { FieldDialog } from './FieldDialog';

interface FieldBuilderProps {
    listId: number;
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
    const fields = useFields(listId);
    const types = useFieldTypes();
    const deleteField = useDeleteField(listId);
    const reorder = useReorderFields(listId);
    const confirm = useConfirm();

    const [dialogOpen, setDialogOpen] = useState(false);
    const [editingField, setEditingField] = useState<FieldEntity | null>(null);
    const [search, setSearch] = useState('');
    const dragIndexRef = useRef<number | null>(null);

    const typeLabels = useMemo(() => {
        const map = new Map<string, string>();
        for (const t of types.data ?? []) map.set(t.slug, t.label);
        return map;
    }, [types.data]);

    const all = fields.data ?? [];
    const term = search.trim().toLowerCase();
    const visible = term
        ? all.filter(
              (f) => f.label.toLowerCase().includes(term) || f.slug.toLowerCase().includes(term),
          )
        : all;

    // Reordenar sólo tiene sentido sobre la lista COMPLETA: con un
    // filtro activo, soltar una fila entre otras dos no describe una
    // posición real.
    const canReorder = term === '' && all.length > 1;

    const openCreate = (): void => {
        setEditingField(null);
        setDialogOpen(true);
    };
    const openEdit = (field: FieldEntity): void => {
        setEditingField(field);
        setDialogOpen(true);
    };

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

            {all.length > 0 && visible.length === 0 && (
                <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                    {__('Ningún campo coincide con la búsqueda.')}
                </p>
            )}

            {visible.length > 0 && (
                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
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
}: FieldRowProps): JSX.Element {
    const Icon = fieldTypeIcon(field.type);
    return (
        <li
            draggable={draggable}
            onDragStart={onDragStart}
            onDragOver={onDragOver}
            onDrop={onDrop}
            className="imcrm-group imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-2 imcrm-py-2 hover:imcrm-bg-accent/30"
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
                className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-3 imcrm-rounded-md imcrm-px-1 imcrm-py-1 imcrm-text-left focus:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary"
            >
                <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                    <Icon className="imcrm-h-4 imcrm-w-4" aria-hidden />
                </span>
                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                    <span className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                        <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium">
                            {field.label}
                        </span>
                        {field.is_primary && (
                            <Badge variant="secondary" className="imcrm-gap-1">
                                <KeyRound className="imcrm-h-3 imcrm-w-3" />
                                {__('Principal')}
                            </Badge>
                        )}
                        {field.is_required && <Badge variant="outline">{__('Obligatorio')}</Badge>}
                        {field.is_unique && <Badge variant="outline">{__('Sin repetidos')}</Badge>}
                    </span>
                    <span className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                        {typeLabel}
                    </span>
                </span>
            </button>

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
