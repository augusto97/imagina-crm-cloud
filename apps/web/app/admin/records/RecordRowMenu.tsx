import { useState } from 'react';
import { Check, Columns3, CopyPlus, Hash, Link2, SquareArrowOutUpRight, Trash2 } from 'lucide-react';

import { useConfirm } from '@/components/ui/confirm-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { useCreateRecord, useDeleteRecord } from '@/hooks/useRecords';
import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

/** Dónde se abrió el menú y sobre qué registro. */
export interface RowMenuTarget {
    record: RecordEntity;
    x: number;
    y: number;
}

interface RecordRowMenuProps {
    target: RowMenuTarget | null;
    onClose: () => void;
    listId: number;
    listSlug: string;
    fields: FieldEntity[];
    /** Abre el registro (modal o página) — mismo destino que el click. */
    onOpen: (record: RecordEntity) => void;
    /** Alta de campo desde el menú; si no se pasa, la opción no aparece. */
    onAddColumn?: () => void;
    canDelete: boolean;
    canCreate: boolean;
}

/**
 * Menú contextual de una fila (v0.1.129) — click DERECHO sobre el registro,
 * como en ClickUp.
 *
 * Sólo entran acciones que existen de verdad en la app; el menú de ClickUp
 * trae cosas que acá no tienen equivalente (seguir la tarea, recordatorios,
 * combinar, tipo de tarea) y ponerlas apagadas sería peor que no ponerlas.
 *
 * El menú se ancla a un punto FIJO del viewport: Radix necesita un trigger,
 * así que se renderiza uno de 0×0 en las coordenadas del click. Es la forma
 * de tener un menú contextual sin reimplementar el posicionamiento, el
 * teclado y el cierre por click afuera.
 */
export function RecordRowMenu({
    target,
    onClose,
    listId,
    listSlug,
    fields,
    onOpen,
    onAddColumn,
    canDelete,
    canCreate,
}: RecordRowMenuProps): JSX.Element | null {
    const create = useCreateRecord(listId);
    const remove = useDeleteRecord(listId);
    const confirm = useConfirm();
    const toast = useToast();
    const [copied, setCopied] = useState<'link' | 'id' | null>(null);

    if (target === null) return null;
    const record = target.record;

    const recordUrl = `${window.location.origin}${window.location.pathname}#/lists/${listSlug}/records/${record.id}`;

    const copy = async (text: string, which: 'link' | 'id'): Promise<void> => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(which);
            toast.success(which === 'link' ? __('Enlace copiado') : __('ID copiado'));
            setTimeout(() => setCopied(null), 1500);
        } catch {
            /* portapapeles bloqueado — no-op */
        }
    };

    /**
     * Duplicar: se copian los valores de los campos que se pueden escribir.
     * Los `computed` los calcula el backend en cada lectura y los `file` /
     * `relation` apuntan a otras entidades — copiarlos a ciegas crearía
     * vínculos compartidos que el usuario no pidió.
     */
    const duplicate = async (): Promise<void> => {
        const values: Record<string, unknown> = {};
        for (const f of fields) {
            if (f.type === 'computed' || f.type === 'relation' || f.type === 'file') continue;
            const v = record.fields[f.slug];
            if (v !== undefined && v !== null && v !== '') values[f.slug] = v;
        }
        try {
            await create.mutateAsync(values);
            toast.success(__('Registro duplicado'));
        } catch (err) {
            if (err instanceof Error) toast.error(__('No se pudo duplicar'), err.message);
        }
    };

    const del = async (): Promise<void> => {
        const ok = await confirm({
            title: __('¿Eliminar este registro?'),
            description: sprintf(
                /* translators: %d: record id */
                __('Se quita de la lista. Podés recuperarlo desde la papelera si hiciera falta. (#%d)'),
                record.id,
            ),
            confirmLabel: __('Eliminar'),
            destructive: true,
        });
        if (!ok) return;
        await remove.mutateAsync({ id: record.id });
        toast.success(__('Registro eliminado'));
    };

    return (
        <DropdownMenu
            open
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <DropdownMenuTrigger asChild>
                <span
                    aria-hidden
                    style={{
                        position: 'fixed',
                        left: target.x,
                        top: target.y,
                        width: 0,
                        height: 0,
                    }}
                />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" sideOffset={2}>
                <DropdownMenuItem onSelect={() => onOpen(record)}>
                    <SquareArrowOutUpRight className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Abrir registro')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void copy(recordUrl, 'link')}>
                    {copied === 'link' ? (
                        <Check className="imcrm-h-3.5 imcrm-w-3.5" />
                    ) : (
                        <Link2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    )}
                    {__('Copiar enlace')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => void copy(String(record.id), 'id')}>
                    {copied === 'id' ? (
                        <Check className="imcrm-h-3.5 imcrm-w-3.5" />
                    ) : (
                        <Hash className="imcrm-h-3.5 imcrm-w-3.5" />
                    )}
                    {__('Copiar ID')}
                </DropdownMenuItem>

                {(canCreate || onAddColumn) && <DropdownMenuSeparator />}
                {canCreate && (
                    <DropdownMenuItem onSelect={() => void duplicate()}>
                        <CopyPlus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Duplicar')}
                    </DropdownMenuItem>
                )}
                {onAddColumn && (
                    <DropdownMenuItem onSelect={onAddColumn}>
                        <Columns3 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Agregar una columna')}
                    </DropdownMenuItem>
                )}

                {canDelete && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem danger onSelect={() => void del()}>
                            <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Eliminar')}
                        </DropdownMenuItem>
                    </>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
