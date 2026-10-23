import { useState } from 'react';
import { DERIVED_FIELD_TYPES } from '@/lib/fieldTypeCatalog';
import {
    ArrowDownToLine,
    Check,
    ClipboardPaste,
    Columns3,
    Copy,
    CopyPlus,
    Eraser,
    Hash,
    Link2,
    ListTree,
    PencilLine,
    Redo2,
    Scissors,
    SquareArrowOutUpRight,
    Trash2,
    Undo2,
} from 'lucide-react';

import { useConfirm } from '@/components/ui/confirm-dialog';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { useCreateRecord, useDeleteRecord } from '@/hooks/useRecords';
import { recordTitleFor, useTrashedToast } from '@/hooks/useTrash';
import { __, sprintf } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { shortcutLabel, type GridMenuActions } from './grid/useGridController';

/** Dónde se abrió el menú y sobre qué registro. */
export interface RowMenuTarget {
    record: RecordEntity;
    x: number;
    y: number;
    /** v0.1.294 — el click derecho fue sobre una celda: el menú suma las acciones de celdas. */
    cell?: boolean;
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
    /** Abre el alta de una SUBTAREA de este registro (v0.1.132). */
    onCreateSubtask?: (record: RecordEntity) => void;
    canDelete: boolean;
    canCreate: boolean;
    /** v0.1.294 — acciones de las celdas elegidas (copiar, cortar, pegar…). */
    cellActions?: GridMenuActions | null;
}

/** El atajo a la derecha de un ítem del menú. */
function Shortcut({ children }: { children: string }): JSX.Element {
    return <span className="imcrm-ml-auto imcrm-pl-6 imcrm-text-[11px] imcrm-tabular-nums imcrm-text-muted-foreground">{children}</span>;
}

/**
 * Menú contextual de una fila (v0.1.129) — click DERECHO sobre el registro,
 * como en ClickUp.
 *
 * Sólo entran acciones que existen de verdad en la app; el menú de ClickUp
 * trae cosas que aquí no tienen equivalente (seguir la tarea, recordatorios,
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
    onCreateSubtask,
    canDelete,
    canCreate,
    cellActions,
}: RecordRowMenuProps): JSX.Element | null {
    const create = useCreateRecord(listId);
    const remove = useDeleteRecord(listId);
    const confirm = useConfirm();
    const toast = useToast();
    const trashed = useTrashedToast();
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
            // v0.1.300 — tampoco el ID automático ni las columnas de sistema (los pone el servidor).
            if (DERIVED_FIELD_TYPES.has(f.type) || f.type === 'relation' || f.type === 'file') continue;
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
                __('Va a la papelera con sus subtareas: puedes recuperarlo durante 30 días. (#%d)'),
                record.id,
            ),
            confirmLabel: __('Eliminar'),
            destructive: true,
        });
        if (!ok) return;
        await remove.mutateAsync({ id: record.id });
        trashed({ type: 'record', id: record.id, name: recordTitleFor(fields, record.fields) });
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
            <DropdownMenuContent
                align="start"
                sideOffset={2}
                className="imcrm-min-w-[15rem]"
                data-testid="imcrm-row-menu"
                // Sobre celdas el foco vuelve a la TABLA (no al disparador
                // invisible del menú): así Ctrl+V / flechas siguen andando.
                onCloseAutoFocus={(e) => {
                    if (!target.cell || !cellActions) return;
                    e.preventDefault();
                    cellActions.restoreFocus();
                }}
            >
                {target.cell && cellActions && (
                    <>
                        <DropdownMenuLabel className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{cellActions.summary}</DropdownMenuLabel>
                        {cellActions.editable && (
                            <DropdownMenuItem onSelect={cellActions.edit}>
                                <PencilLine className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Editar celda')}
                                <Shortcut>Enter</Shortcut>
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuItem onSelect={cellActions.cut} disabled={!cellActions.canEdit}>
                            <Scissors className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Cortar')}
                            <Shortcut>{shortcutLabel('X')}</Shortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={cellActions.copy}>
                            <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Copiar')}
                            <Shortcut>{shortcutLabel('C')}</Shortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={cellActions.paste} disabled={!cellActions.canEdit && !canCreate}>
                            <ClipboardPaste className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Pegar')}
                            <Shortcut>{shortcutLabel('V')}</Shortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={cellActions.clear} disabled={!cellActions.canEdit}>
                            <Eraser className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Borrar contenido')}
                            <Shortcut>{__('Supr')}</Shortcut>
                        </DropdownMenuItem>
                        {cellActions.multiRow && (
                            <DropdownMenuItem onSelect={cellActions.fillDown} disabled={!cellActions.canEdit}>
                                <ArrowDownToLine className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Rellenar hacia abajo')}
                                <Shortcut>{shortcutLabel('D')}</Shortcut>
                            </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={cellActions.undo} disabled={!cellActions.canUndo}>
                            <Undo2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Deshacer')}
                            <Shortcut>{shortcutLabel('Z')}</Shortcut>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={cellActions.redo} disabled={!cellActions.canRedo}>
                            <Redo2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Rehacer')}
                            <Shortcut>{shortcutLabel('Y')}</Shortcut>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuLabel className="imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{__('Registro')}</DropdownMenuLabel>
                    </>
                )}
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
                {canCreate && onCreateSubtask && record.parent_id === null && (
                    <DropdownMenuItem onSelect={() => onCreateSubtask(record)}>
                        <ListTree className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Crear subtarea')}
                    </DropdownMenuItem>
                )}
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
