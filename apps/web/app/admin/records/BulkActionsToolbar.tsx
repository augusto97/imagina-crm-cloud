import { useState } from 'react';
import { Copy, Store, Trash2, Wand2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useBulkRecords, useCreateRecord } from '@/hooks/useRecords';
import { api } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { useStoreRules } from './storeRules';

interface BulkActionsToolbarProps {
    listId: number;
    selectedIds: number[];
    onClear: () => void;
    /** Abre la edición masiva (v0.1.216) sobre la selección. */
    onBulkEdit: () => void;
    /** v0.1.217 — en la lista de productos de una tienda: editar EN WooCommerce. */
    onStoreBulk?: () => void;
}

/**
 * Barra contextual flotante (estilo ClickUp) que aparece cuando hay
 * registros seleccionados. Posicionada `fixed bottom` centrada en el
 * viewport para que no se entierre al final del contenido.
 *
 * Acciones soportadas:
 *  - Editar en lote (v0.1.216): abre la edición masiva con operaciones
 *    (sumar, porcentajes, redondeos, cálculos, agregar/quitar opciones…),
 *    vista previa y aplicación en tandas. Reemplaza al viejo «Actualizar
 *    campo», que sólo sabía poner un valor fijo.
 *  - Duplicar: lee cada record con `useRecord` y crea uno nuevo con
 *    los mismos values.
 *  - Eliminar: soft-delete batch (ya existía).
 *  - Limpiar selección: desmarca todo.
 */
export function BulkActionsToolbar({
    listId,
    selectedIds,
    onClear,
    onBulkEdit,
    onStoreBulk,
}: BulkActionsToolbarProps): JSX.Element | null {
    const bulk = useBulkRecords(listId);
    // v0.1.213 — en una lista de tienda no se duplica ni se borra (se hace
    // en WooCommerce), y sólo se ofrecen las columnas que se pueden cambiar.
    const storeManaged = useStoreRules() !== null;

    if (selectedIds.length === 0) return null;

    const handleDelete = async (): Promise<void> => {
        const ok = confirm(
            sprintf(
                _n(
                    'Eliminar %d registro? Los datos se preservan (soft delete).',
                    'Eliminar %d registros? Los datos se preservan (soft delete).',
                    selectedIds.length,
                ),
                selectedIds.length,
            ),
        );
        if (!ok) return;
        const result = await bulk.mutateAsync({ action: 'delete', ids: selectedIds });
        onClear();
        if (result.failed.length > 0) {
            alert(
                sprintf(__('Se eliminaron %d registros.'), result.succeeded.length)
                + '\n'
                + sprintf(__('Fallaron %d:'), result.failed.length)
                + '\n'
                + result.failed
                    .map((f) => sprintf(__('  #%1$d: %2$s'), f.id, f.message))
                    .join('\n'),
            );
        }
    };

    return (
        <div
            // `fixed` para que la toolbar flote sobre el viewport
            // estilo ClickUp, no se entierre al fondo del contenido.
            // `left-1/2 -translate-x-1/2` la centra horizontalmente.
            // Aria-live para que screen readers anuncien los cambios
            // de selección.
            className={cn(
                'imcrm-fixed imcrm-bottom-6 imcrm-left-1/2 imcrm-z-40 imcrm--translate-x-1/2',
                'imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-xl imcrm-border imcrm-border-border',
                'imcrm-bg-popover imcrm-px-3 imcrm-py-2 imcrm-shadow-imcrm-lg',
            )}
            role="region"
            aria-label={__('Acciones masivas')}
        >
            <span className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-primary/10 imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary">
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
                >
                    <Store className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Editar en la tienda')}
                </Button>
            )}

            <Button
                variant="ghost"
                size="sm"
                className="imcrm-gap-1.5"
                onClick={onBulkEdit}
                data-testid="imcrm-bulk-edit-open"
            >
                <Wand2 className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Editar en lote')}
            </Button>

            {!storeManaged && (
                <DuplicateAction
                    listId={listId}
                    selectedIds={selectedIds}
                    onDone={onClear}
                />
            )}

            {!storeManaged && (
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDelete}
                    disabled={bulk.isPending}
                    className="imcrm-gap-1.5 imcrm-text-destructive hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                >
                    <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    {bulk.isPending ? __('Eliminando…') : __('Eliminar')}
                </Button>
            )}
        </div>
    );
}

/**
 * "Duplicar": para cada selectedId trae el record completo y lo
 * vuelve a crear. Hace los creates en serie (no en paralelo) para
 * no sobrecargar el server con N requests simultáneos. UX: spinner
 * inline durante la operación; al terminar limpia selección.
 */
function DuplicateAction({
    listId,
    selectedIds,
    onDone,
}: {
    listId: number;
    selectedIds: number[];
    onDone: () => void;
}): JSX.Element {
    const create = useCreateRecord(listId);
    const [busy, setBusy] = useState(false);

    const run = async (): Promise<void> => {
        setBusy(true);
        let ok = 0;
        let fail = 0;
        for (const id of selectedIds) {
            try {
                // Lee el record actual y dispara un create con sus
                // values. Hacemos los lookups en serie para no
                // bombardear el server con N requests paralelos.
                const res = await api.get<{ fields: Record<string, unknown> }>(
                    `/lists/${listId}/records/${id}`,
                );
                const fields = res.data.fields ?? {};
                await create.mutateAsync(fields);
                ok++;
            } catch {
                fail++;
            }
        }
        setBusy(false);
        onDone();
        if (fail > 0) {
            alert(sprintf(__('Duplicados: %d. Fallaron: %d.'), ok, fail));
        }
    };

    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={() => void run()}
            disabled={busy}
            className="imcrm-gap-1.5"
        >
            <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
            {busy ? __('Duplicando…') : __('Duplicar')}
        </Button>
    );
}
