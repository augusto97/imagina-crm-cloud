import { Copy, CornerDownRight, Layers, Store, Trash2, UserPlus, Wand2, X } from 'lucide-react';
import type { BulkStructureAction } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { __, _n, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface BulkActionsToolbarProps {
    selectedIds: number[];
    onClear: () => void;
    /** Abre la edición masiva (v0.1.216) sobre la selección. */
    onBulkEdit: () => void;
    /** v0.1.217 — en la lista de productos de una tienda: editar EN WooCommerce. */
    onStoreBulk?: () => void;
    /** v0.1.223 — crear variaciones en lote (productos variables de la tienda). */
    onStoreVariations?: () => void;
    /**
     * v0.1.220 — mover como subtareas, duplicar y borrar en lote (con vista
     * previa y deshacer). Cada acción sólo aparece si el rol puede hacerla y
     * la lista no es de la tienda.
     */
    onStructure?: Partial<Record<BulkStructureAction, () => void>>;
    /** v0.1.220 — atajo: asignar un responsable (edición masiva preparada). */
    onAssign?: () => void;
}

/**
 * Barra contextual flotante (estilo ClickUp) que aparece cuando hay
 * registros seleccionados. Posicionada `fixed bottom` centrada en el
 * viewport para que no se entierre al final del contenido.
 *
 * Acciones soportadas:
 *  - Editar en lote (v0.1.216): operaciones (sumar, porcentajes, redondeos,
 *    cálculos, agregar/quitar opciones…) con vista previa y deshacer.
 *  - Asignar (v0.1.220): la misma edición masiva, ya apuntada al campo de
 *    persona.
 *  - Mover, duplicar y eliminar (v0.1.220): acciones de estructura con vista
 *    previa, tandas y deshacer — reemplazan al duplicado registro por
 *    registro desde el navegador y al `confirm()` nativo del borrado.
 *  - Limpiar selección: desmarca todo.
 */
export function BulkActionsToolbar({
    selectedIds,
    onClear,
    onBulkEdit,
    onStoreBulk,
    onStoreVariations,
    onStructure,
    onAssign,
}: BulkActionsToolbarProps): JSX.Element | null {
    if (selectedIds.length === 0) return null;

    return (
        <div
            // `fixed` para que la toolbar flote sobre el viewport
            // estilo ClickUp, no se entierre al fondo del contenido.
            // `left-1/2 -translate-x-1/2` la centra horizontalmente.
            // Aria-live para que screen readers anuncien los cambios
            // de selección.
            className={cn(
                'imcrm-fixed imcrm-bottom-6 imcrm-left-1/2 imcrm-z-40 imcrm--translate-x-1/2',
                // En el teléfono las acciones quedan sólo con su icono y, si
                // aun así no entran, la barra scrollea en horizontal.
                'imcrm-max-w-[calc(100vw-1rem)] imcrm-overflow-x-auto',
                'imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-xl imcrm-border imcrm-border-border',
                'imcrm-bg-popover imcrm-px-3 imcrm-py-2 imcrm-shadow-imcrm-lg',
            )}
            role="region"
            aria-label={__('Acciones masivas')}
        >
            <span className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-2 imcrm-whitespace-nowrap imcrm-rounded-md imcrm-bg-primary/10 imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary">
                {sprintf(
                    _n('%d seleccionado', '%d seleccionados', selectedIds.length),
                    selectedIds.length,
                )}
                <button
                    type="button"
                    onClick={onClear}
                    aria-label={__('Limpiar selección')}
                    className="imcrm-rounded imcrm-text-primary/70 hover:imcrm-text-primary"
                >
                    <X className="imcrm-h-3.5 imcrm-w-3.5" />
                </button>
            </span>

            <div className="imcrm-h-5 imcrm-w-px imcrm-bg-border imcrm-mx-1" aria-hidden />

            {onStoreBulk && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="imcrm-gap-1.5 imcrm-text-[#7F54B3] hover:imcrm-text-[#7F54B3]"
                    onClick={onStoreBulk}
                    data-testid="imcrm-store-bulk-open"
                    aria-label={__('Editar en la tienda')}
                    title={__('Editar en la tienda')}
                >
                    <Store className="imcrm-h-3.5 imcrm-w-3.5" />
                    <span className="imcrm-hidden sm:imcrm-inline">{__('Editar en la tienda')}</span>
                </Button>
            )}

            {onStoreVariations && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="imcrm-gap-1.5 imcrm-text-[#7F54B3] hover:imcrm-text-[#7F54B3]"
                    onClick={onStoreVariations}
                    data-testid="imcrm-store-variations-open"
                    aria-label={__('Crear variaciones')}
                    title={__('Crear variaciones')}
                >
                    <Layers className="imcrm-h-3.5 imcrm-w-3.5" />
                    <span className="imcrm-hidden sm:imcrm-inline">{__('Crear variaciones')}</span>
                </Button>
            )}

            <Button
                variant="ghost"
                size="sm"
                className="imcrm-gap-1.5"
                onClick={onBulkEdit}
                data-testid="imcrm-bulk-edit-open"
                aria-label={__('Editar en lote')}
                title={__('Editar en lote')}
            >
                <Wand2 className="imcrm-h-3.5 imcrm-w-3.5" />
                <span className="imcrm-hidden sm:imcrm-inline">{__('Editar en lote')}</span>
            </Button>

            {onAssign && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="imcrm-gap-1.5"
                    onClick={onAssign}
                    data-testid="imcrm-bulk-assign-open"
                    aria-label={__('Asignar')}
                    title={__('Asignar')}
                >
                    <UserPlus className="imcrm-h-3.5 imcrm-w-3.5" />
                    <span className="imcrm-hidden sm:imcrm-inline">{__('Asignar')}</span>
                </Button>
            )}

            {onStructure?.move && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="imcrm-gap-1.5"
                    onClick={onStructure.move}
                    data-testid="imcrm-bulk-move-open"
                    aria-label={__('Mover')}
                    title={__('Mover')}
                >
                    <CornerDownRight className="imcrm-h-3.5 imcrm-w-3.5" />
                    <span className="imcrm-hidden sm:imcrm-inline">{__('Mover')}</span>
                </Button>
            )}

            {onStructure?.duplicate && (
                <Button
                    variant="ghost"
                    size="sm"
                    className="imcrm-gap-1.5"
                    onClick={onStructure.duplicate}
                    data-testid="imcrm-bulk-duplicate-open"
                    aria-label={__('Duplicar')}
                    title={__('Duplicar')}
                >
                    <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                    <span className="imcrm-hidden sm:imcrm-inline">{__('Duplicar')}</span>
                </Button>
            )}

            {onStructure?.delete && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={onStructure.delete}
                    className="imcrm-gap-1.5 imcrm-text-destructive hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                    data-testid="imcrm-bulk-delete-open"
                    aria-label={__('Eliminar')}
                    title={__('Eliminar')}
                >
                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    <span className="imcrm-hidden sm:imcrm-inline">{__('Eliminar')}</span>
                </Button>
            )}
        </div>
    );
}
