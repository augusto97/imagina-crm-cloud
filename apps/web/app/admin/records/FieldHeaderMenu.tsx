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
    Pencil,
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
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

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
 * "Convertir tipo" no vive acá (migra datos): está en el administrador de
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
    /** Abre el editor del campo (lo gestiona RecordsPage). */
    onEdit: (field: FieldEntity) => void;
    /** Ordenar por esta columna. Sin esto el item no se renderiza. */
    onSort?: (field: FieldEntity, dir: 'asc' | 'desc') => void;
    /** Ocultar la columna en la vista actual. */
    onHide?: (field: FieldEntity) => void;
    /** Abrir el selector de cálculo del pie para esta columna. */
    onCalculate?: (field: FieldEntity) => void;
    /** La vista sincroniza SU orden de columnas tras mover el campo. */
    onReorderColumns?: (fieldIdsInOrder: number[]) => void;
}

export function FieldHeaderMenu({
    listId,
    listSlug,
    field,
    fields,
    onEdit,
    onSort,
    onHide,
    onCalculate,
    onReorderColumns,
}: FieldHeaderMenuProps): JSX.Element {
    const create = useCreateField(listId);
    const del = useDeleteField(listId);
    const reorder = useReorderFields(listId);
    const confirm = useConfirm();
    const toast = useToast();
    const navigate = useNavigate();

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
            description: __('La columna desaparecerá de la lista y sus valores dejarán de mostrarse en los registros.'),
            confirmLabel: __('Eliminar'),
            destructive: true,
        });
        if (!ok) return;
        try {
            await del.mutateAsync({ id: field.id });
            toast.success(__('Campo eliminado'));
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

                {canMove && (
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
                {listSlug !== undefined && (
                    <DropdownMenuItem onSelect={() => navigate(`/lists/${listSlug}/automations/new`)}>
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

                <DropdownMenuItem
                    disabled={create.isPending}
                    onSelect={() => void handleDuplicate()}
                >
                    <Copy className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {__('Duplicar')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void handleCopyId()}>
                    <Hash className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {__('Copiar ID de campo')}
                </DropdownMenuItem>
                <DropdownMenuItem
                    danger
                    disabled={del.isPending}
                    onSelect={() => void handleDelete()}
                >
                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {__('Eliminar')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
