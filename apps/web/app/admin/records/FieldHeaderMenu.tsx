import { useNavigate } from 'react-router';
import {
    ArrowDownAZ,
    ArrowUpAZ,
    ChevronDown,
    ChevronsLeft,
    ChevronsRight,
    Copy,
    EyeOff,
    Hash,
    Lock,
    Paintbrush,
    Pencil,
    Pin,
    PinOff,
    Sigma,
    TextCursorInput,
    Trash2,
    Zap,
} from 'lucide-react';

import { useConfirm } from '@/components/ui/confirm-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { useCreateField, useDeleteField, useReorderFields } from '@/hooks/useFields';
import { useTrashedToast } from '@/hooks/useTrash';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { storeColumnKind, useStoreRules } from './storeRules';

/**
 * Menú contextual por columna en el header de la tabla (v0.1.74, completado
 * en v0.1.160 con las acciones que ClickUp ofrece y nosotros ya sabíamos
 * hacer, pero sólo desde otras pantallas).
 *
 * Cada item cablea a algo que YA existe — no hay acciones decorativas:
 *
 *   - Ordenar asc/desc → el sort server-side de la vista (v0.1.76).
 *   - Modificar / Cambiar el nombre → el editor del campo.
 *   - Privacidad y permisos → el panel de permisos por rol de la lista.
 *   - Mover al inicio / al final → `position` del campo (persistente para
 *     toda la lista, como ClickUp) + el `columnOrder` de la vista si la
 *     vista tiene uno propio, para que el efecto se vea al instante.
 *   - Calcular → abre el selector de agregado de ESA columna en el pie.
 *   - Automatizar → editor de automatizaciones de la lista.
 *   - Ocultar columna → `columnVisibility` de la vista.
 *   - Duplicar / Copiar ID / Eliminar.
 *
 * "Convertir tipo" no vive aquí (migra datos): está en el administrador de
 * campos, a un click desde "Modificar".
 *
 * El trigger vive dentro de un `<th draggable>` con botón de sort: paramos
 * la propagación del click/mousedown y prevenimos el dragstart, igual que
 * el resize handle del mismo th.
 */
interface FieldHeaderMenuProps {
    listId: number;
    /** Slug de la lista — para navegar a permisos / automatizaciones. */
    listSlug?: string;
    field: FieldEntity;
    /** Todos los campos visibles, en su orden actual (para mover). */
    fields?: FieldEntity[];
    /**
     * Abre el editor del campo (lo gestiona RecordsPage). Sin él (quien no
     * administra la lista) el menú sólo trae lo de la VISTA: ordenar,
     * calcular, ocultar, fijar y colorear — nada que cambie el campo.
     */
    onEdit?: (field: FieldEntity) => void;
    /** Ordenar por esta columna. Sin esto el item no se renderiza. */
    onSort?: (field: FieldEntity, dir: 'asc' | 'desc') => void;
    /** Ocultar la columna en la vista actual. */
    onHide?: (field: FieldEntity) => void;
    /** Abrir el selector de cálculo del pie para esta columna. */
    onCalculate?: (field: FieldEntity) => void;
    /** La vista sincroniza SU orden de columnas tras mover el campo. */
    onReorderColumns?: (fieldIdsInOrder: number[]) => void;
    /** v0.1.287 — "Fijar hasta esta columna" (columnas fijas a la izquierda). */
    onFreeze?: (field: FieldEntity) => void;
    /** v0.1.287 — "Dejar de fijar" (sólo si la vista tiene columnas fijadas). */
    onUnfreeze?: () => void;
    /** v0.1.287 — Atajo a "Colorear filas" con una regla sobre esta columna. */
    onColor?: (field: FieldEntity) => void;
}

export function FieldHeaderMenu({
    listId,
    listSlug,
    field,
    fields,
    onEdit,
    onHide,
    onReorderColumns,
    onFreeze,
    onUnfreeze,
    onColor: onColorProp,
    onSort: onSortProp,
    onCalculate: onCalculateProp,
}: FieldHeaderMenuProps): JSX.Element {
    // Campo «Botón»: no tiene valor que ordenar, colorear ni sumar.
    const isButton = field.type === 'button';
    const onSort = isButton ? undefined : onSortProp;
    const onColor = isButton ? undefined : onColorProp;
    const onCalculate = isButton ? undefined : onCalculateProp;
    const create = useCreateField(listId);
    const del = useDeleteField(listId);
    const reorder = useReorderFields(listId);
    const confirm = useConfirm();
    const toast = useToast();
    const trashed = useTrashedToast();
    const navigate = useNavigate();
    // v0.1.213 — una columna que viene de la tienda sólo cambia de nombre:
    // no se borra (la próxima sincronización la necesita) ni se automatiza si
    // es de sólo lectura (el motor la saltearía).
    const storeKind = storeColumnKind(useStoreRules(), field.id);
    const isStoreField = storeKind === 'store_locked' || storeKind === 'store_sync';

    const handleMove = async (to: 'start' | 'end'): Promise<void> => {
        const all = fields ?? [];
        if (all.length < 2) return;
        const rest = all.filter((f) => f.id !== field.id);
        const next = to === 'start' ? [field, ...rest] : [...rest, field];
        const ids = next.map((f) => f.id);
        try {
            await reorder.mutateAsync(ids);
            onReorderColumns?.(ids);
            toast.success(to === 'start' ? __('Movido al inicio') : __('Movido al final'));
        } catch (err) {
            toast.error(
                __('No se pudo mover la columna'),
                err instanceof Error ? err.message : undefined,
            );
        }
    };

    const handleDuplicate = async (): Promise<void> => {
        try {
            await create.mutateAsync({
                label: sprintf(
                    /* translators: %s: label del campo original */
                    __('%s (copia)'),
                    field.label,
                ),
                type: field.type,
                config: field.config,
                is_required: field.is_required,
            });
            toast.success(__('Campo duplicado'));
        } catch (err) {
            toast.error(
                __('No se pudo duplicar el campo'),
                err instanceof Error ? err.message : undefined,
            );
        }
    };

    const handleCopyId = async (): Promise<void> => {
        try {
            await navigator.clipboard.writeText(String(field.id));
            toast.success(__('ID de campo copiado'), `#${field.id}`);
        } catch {
            toast.error(__('No se pudo copiar al portapapeles'));
        }
    };

    const handleDelete = async (): Promise<void> => {
        const ok = await confirm({
            title: sprintf(
                /* translators: %s: label del campo */
                __('¿Eliminar el campo "%s"?'),
                field.label,
            ),
            description: __('La columna va a la papelera con sus valores: puedes recuperarla tal cual durante 30 días.'),
            confirmLabel: __('Eliminar'),
            destructive: true,
        });
        if (!ok) return;
        try {
            await del.mutateAsync({ id: field.id });
            trashed({ type: 'field', id: field.id, name: field.label });
        } catch (err) {
            toast.error(
                __('No se pudo eliminar el campo'),
                err instanceof Error ? err.message : undefined,
            );
        }
    };

    const canMove = (fields?.length ?? 0) > 1;

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    // No disparar el sort/drawer ni el drag de la columna:
                    // el th padre es draggable y tiene su propio click.
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    draggable={false}
                    onDragStart={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                    }}
                    aria-label={sprintf(
                        /* translators: %s: label del campo */
                        __('Opciones del campo %s'),
                        field.label,
                    )}
                    title={__('Opciones del campo')}
                    className={cn(
                        'imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground/60 imcrm-transition-opacity',
                        // Visible solo on-hover del th (o con el menú
                        // abierto / foco por teclado).
                        'imcrm-opacity-0 group-hover/th:imcrm-opacity-100 focus-visible:imcrm-opacity-100 data-[state=open]:imcrm-opacity-100',
                        'hover:imcrm-bg-muted hover:imcrm-text-foreground',
                        'focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40',
                    )}
                >
                    <ChevronDown className="imcrm-h-3 imcrm-w-3" aria-hidden />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="imcrm-w-56">
                {onSort && (
                    <>
                        <DropdownMenuItem onSelect={() => onSort(field, 'asc')}>
                            <ArrowUpAZ className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {__('Ordenar ascendente')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onSort(field, 'desc')}>
                            <ArrowDownAZ className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {__('Ordenar descendente')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                    </>
                )}

                {onEdit && (
                    <>
                        <DropdownMenuItem onSelect={() => onEdit(field)}>
                            <Pencil className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {__('Modificar el campo')}
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => onEdit(field)}>
                            <TextCursorInput className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {__('Cambiar el nombre')}
                        </DropdownMenuItem>
                        {listSlug !== undefined && (
                            <DropdownMenuItem onSelect={() => navigate(`/lists/${listSlug}/edit?s=permisos`)}>
                                <Lock className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                {__('Privacidad y permisos')}
                            </DropdownMenuItem>
                        )}

                        <DropdownMenuSeparator />
                    </>
                )}

                {onFreeze && (
                    <DropdownMenuItem onSelect={() => onFreeze(field)}>
                        <Pin className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Fijar hasta esta columna')}
                    </DropdownMenuItem>
                )}
                {onUnfreeze && (
                    <DropdownMenuItem onSelect={() => onUnfreeze()}>
                        <PinOff className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Dejar de fijar')}
                    </DropdownMenuItem>
                )}
                {onColor && (
                    <DropdownMenuItem onSelect={() => onColor(field)}>
                        <Paintbrush className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Colorear filas según esta columna…')}
                    </DropdownMenuItem>
                )}
                {(onFreeze || onUnfreeze || onColor) && <DropdownMenuSeparator />}

                {onEdit && canMove && (
                    <>
                        <DropdownMenuItem
                            disabled={reorder.isPending}
                            onSelect={() => void handleMove('start')}
                        >
                            <ChevronsLeft className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {__('Mover al inicio')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                            disabled={reorder.isPending}
                            onSelect={() => void handleMove('end')}
                        >
                            <ChevronsRight className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {__('Mover al final')}
                        </DropdownMenuItem>
                    </>
                )}
                {onCalculate && (
                    <DropdownMenuItem onSelect={() => onCalculate(field)}>
                        <Sigma className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Calcular')}
                    </DropdownMenuItem>
                )}
                {onEdit && listSlug !== undefined && storeKind !== 'store_locked' && (
                    <DropdownMenuItem
                        onSelect={() =>
                            // Con el campo en la URL, el editor abre con la
                            // acción "Actualizar campo" ya armada para ESA
                            // columna — llegar al editor vacío no servía de
                            // nada (reporte del usuario, v0.1.161).
                            navigate(
                                isButton
                                    // Un botón se automatiza con el disparador
                                    // «Al presionar el botón» ya apuntado a él.
                                    ? `/lists/${listSlug}/automations/new?trigger=button_pressed&button=${field.id}`
                                    : `/lists/${listSlug}/automations/new`
                                      + `?action=update_field&field=${field.id}`,
                            )
                        }
                    >
                        <Zap className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Automatizar')}
                    </DropdownMenuItem>
                )}
                {onHide && (
                    <DropdownMenuItem onSelect={() => onHide(field)}>
                        <EyeOff className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Ocultar columna')}
                    </DropdownMenuItem>
                )}

                <DropdownMenuSeparator />

                {onEdit && (
                    <DropdownMenuItem
                        disabled={create.isPending}
                        onSelect={() => void handleDuplicate()}
                    >
                        <Copy className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Duplicar')}
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={() => void handleCopyId()}>
                    <Hash className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {__('Copiar ID de campo')}
                </DropdownMenuItem>
                {onEdit && !isStoreField && (
                    <DropdownMenuItem
                        danger
                        disabled={del.isPending}
                        onSelect={() => void handleDelete()}
                    >
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Eliminar')}
                    </DropdownMenuItem>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
