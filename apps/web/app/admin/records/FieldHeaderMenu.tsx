import { ChevronDown, Copy, Hash, Pencil, Trash2, TextCursorInput } from 'lucide-react';

import { useConfirm } from '@/components/ui/confirm-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { useCreateField, useDeleteField } from '@/hooks/useFields';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

/**
 * Menú contextual por columna (campo) en el header de la tabla de
 * registros — estilo ClickUp (v0.1.74). Acciones:
 *
 *   - Modificar / Cambiar el nombre → abren el FieldCreateDialog en
 *     modo edición (el Nombre ya viene autoenfocado, así "renombrar"
 *     no necesita UI propia).
 *   - Duplicar → crea un campo nuevo con el mismo tipo/config y el
 *     label "… (copia)".
 *   - Copiar ID de campo → clipboard + toast.
 *   - Eliminar → confirm destructivo + delete (los invalidates de los
 *     hooks refrescan la tabla solos).
 *
 * "Convertir tipo" NO vive acá (migra datos) — queda en el editor de
 * lista, accesible desde "Modificar" → link de configuración avanzada.
 *
 * El trigger vive dentro de un `<th draggable>` con botón de sort:
 * paramos la propagación del click/mousedown (no disparar sort ni
 * abrir nada más) y prevenimos el dragstart (no iniciar el reorden de
 * columnas), igual que el resize handle del mismo th.
 */
interface FieldHeaderMenuProps {
    listId: number;
    field: FieldEntity;
    /** Abre el dialog de edición del campo (lo gestiona RecordsPage). */
    onEdit: (field: FieldEntity) => void;
}

export function FieldHeaderMenu({
    listId,
    field,
    onEdit,
}: FieldHeaderMenuProps): JSX.Element {
    const create = useCreateField(listId);
    const del = useDeleteField(listId);
    const confirm = useConfirm();
    const toast = useToast();

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
            <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => onEdit(field)}>
                    <Pencil className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {__('Modificar')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onEdit(field)}>
                    <TextCursorInput className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {__('Cambiar el nombre')}
                </DropdownMenuItem>
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
                <DropdownMenuSeparator />
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
