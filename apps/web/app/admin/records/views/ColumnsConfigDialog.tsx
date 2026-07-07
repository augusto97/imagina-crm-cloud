import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Eye, EyeOff, GripVertical, RotateCcw, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

interface ColumnsConfigDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    fields: FieldEntity[];
    columnOrder: string[];
    visibility: Record<string, boolean>;
    onApply: (next: { columnOrder: string[]; visibility: Record<string, boolean> }) => void;
}

/**
 * Dialog "Configurar columnas" — UI dedicada para reordenar + mostrar/ocultar
 * todas las columnas de la tabla en un solo lugar.
 *
 * Antes el usuario tenía que arrastrar columna por columna desde la
 * cabecera de la tabla, lo cual es engorroso cuando hay muchas. Este
 * dialog lista TODAS las columnas verticalmente con drag handles +
 * toggle de visibilidad + reset.
 *
 * El reorder usa HTML5 native drag (igual que TableView headers) para
 * mantener consistencia y no introducir nuevas deps.
 *
 * Cambios solo se commitean al click "Aplicar" — cancel descarta el
 * draft.
 */
export function ColumnsConfigDialog({
    open,
    onOpenChange,
    fields,
    columnOrder,
    visibility,
    onApply,
}: ColumnsConfigDialogProps): JSX.Element {
    // Construye el orden default: id → fields (por position) → updated_at.
    // Se usa cuando `columnOrder` viene vacío (vista nueva sin persistir).
    const buildDefaultOrder = (): string[] => {
        const dyn = fields
            .filter((f) => f.type !== 'relation')
            .sort((a, b) => a.position - b.position)
            .map((f) => f.slug);
        return ['id', ...dyn, 'updated_at'];
    };

    // Borrador local del orden — el draft no se commitea al state global
    // hasta "Aplicar". Permite hacer experimentos sin afectar la tabla.
    const [draftOrder, setDraftOrder] = useState<string[]>(
        columnOrder.length > 0 ? columnOrder : buildDefaultOrder(),
    );
    const [draftVisibility, setDraftVisibility] = useState<Record<string, boolean>>(visibility);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);

    // Re-inicializa el draft cada vez que se abre. Deps solo `open` para
    // no resetear durante el drag (los props cambian de referencia).
    useEffect(() => {
        if (! open) return;
        setDraftOrder(columnOrder.length > 0 ? columnOrder : buildDefaultOrder());
        setDraftVisibility(visibility);
        setDraggingId(null);
        setDropTargetId(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Construye items renderables. Si el draftOrder tiene columnas que
    // no existen (campo borrado), las filtramos. Si hay columnas que
    // existen pero no están en el orden (campo nuevo), las agregamos al
    // final con visibilidad true.
    const labelFor = (id: string): string => {
        if (id === 'id') return __('ID');
        if (id === 'updated_at') return __('Actualizado');
        const f = fields.find((x) => x.slug === id);
        return f ? f.label : id;
    };
    const typeFor = (id: string): string | null => {
        if (id === 'id') return __('sistema');
        if (id === 'updated_at') return __('sistema');
        return fields.find((x) => x.slug === id)?.type ?? null;
    };
    const isFieldGone = (id: string): boolean => {
        if (id === 'id' || id === 'updated_at') return false;
        return ! fields.some((x) => x.slug === id);
    };

    const knownIds = new Set([
        'id',
        'updated_at',
        ...fields.filter((f) => f.type !== 'relation').map((f) => f.slug),
    ]);
    const orderedIds = draftOrder.filter((id) => knownIds.has(id));
    const missingIds = [...knownIds].filter((id) => ! orderedIds.includes(id));
    const fullOrder = [...orderedIds, ...missingIds];

    const toggleVisible = (id: string): void => {
        setDraftVisibility((prev) => ({
            ...prev,
            [id]: prev[id] === false ? true : false,
        }));
    };

    const moveTo = (sourceId: string, targetId: string): void => {
        if (sourceId === targetId) return;
        setDraftOrder((prev) => {
            const list = prev.filter((id) => knownIds.has(id));
            const sourceIdx = list.indexOf(sourceId);
            const targetIdx = list.indexOf(targetId);
            if (sourceIdx < 0 || targetIdx < 0) return prev;
            const next = [...list];
            const [removed] = next.splice(sourceIdx, 1);
            if (! removed) return prev;
            // Inserta ANTES del target si venía después; DESPUÉS si venía antes.
            const insertAt = sourceIdx < targetIdx ? targetIdx : targetIdx;
            next.splice(insertAt, 0, removed);
            return next;
        });
    };

    const moveUp = (id: string): void => {
        const idx = fullOrder.indexOf(id);
        if (idx <= 0) return;
        const prev = fullOrder[idx - 1];
        if (prev) moveTo(id, prev);
    };
    const moveDown = (id: string): void => {
        const idx = fullOrder.indexOf(id);
        if (idx < 0 || idx >= fullOrder.length - 1) return;
        const next = fullOrder[idx + 1];
        if (next) moveTo(id, next);
    };

    const resetOrder = (): void => {
        setDraftOrder(buildDefaultOrder());
    };
    const resetVisibility = (): void => {
        setDraftVisibility({});
    };
    const hideAll = (): void => {
        const next: Record<string, boolean> = {};
        for (const id of fullOrder) next[id] = false;
        setDraftVisibility(next);
    };
    const showAll = (): void => {
        setDraftVisibility({});
    };

    const handleApply = (): void => {
        onApply({
            columnOrder: fullOrder,
            visibility: draftVisibility,
        });
        onOpenChange(false);
    };

    const visibleCount = fullOrder.filter(
        (id) => draftVisibility[id] !== false,
    ).length;
    const totalCount = fullOrder.length;

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-full imcrm-max-w-md',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-flex imcrm-max-h-[85vh] imcrm-flex-col imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-lg',
                    )}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-6 imcrm-py-4">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {__('Configurar columnas')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Arrastrá para reordenar. Click en el ojo para ocultar.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-bg-muted/20 imcrm-px-6 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                        <span>
                            {visibleCount} {__('de')} {totalCount} {__('visibles')}
                        </span>
                        <div className="imcrm-flex imcrm-gap-1">
                            <button
                                type="button"
                                onClick={showAll}
                                className="imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs hover:imcrm-bg-accent"
                            >
                                {__('Mostrar todas')}
                            </button>
                            <span className="imcrm-text-muted-foreground/40">·</span>
                            <button
                                type="button"
                                onClick={hideAll}
                                className="imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs hover:imcrm-bg-accent"
                            >
                                {__('Ocultar todas')}
                            </button>
                        </div>
                    </div>

                    <ul className="imcrm-flex-1 imcrm-overflow-y-auto imcrm-py-1">
                        {fullOrder.map((id) => {
                            const visible = draftVisibility[id] !== false;
                            const gone = isFieldGone(id);
                            const isDragging = draggingId === id;
                            const isDropTarget = dropTargetId === id && draggingId !== id;
                            return (
                                <li
                                    key={id}
                                    draggable={!gone}
                                    onDragStart={(e) => {
                                        e.dataTransfer.effectAllowed = 'move';
                                        e.dataTransfer.setData('text/plain', id);
                                        setDraggingId(id);
                                    }}
                                    onDragEnd={() => {
                                        setDraggingId(null);
                                        setDropTargetId(null);
                                    }}
                                    onDragOver={(e) => {
                                        if (draggingId === null || draggingId === id) return;
                                        e.preventDefault();
                                        e.dataTransfer.dropEffect = 'move';
                                        setDropTargetId(id);
                                    }}
                                    onDragLeave={(e) => {
                                        // Solo limpia si salimos del elemento, no de un hijo.
                                        if (
                                            e.currentTarget.contains(e.relatedTarget as Node)
                                        ) return;
                                        if (dropTargetId === id) setDropTargetId(null);
                                    }}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        const sourceId = e.dataTransfer.getData('text/plain');
                                        if (sourceId && sourceId !== id) {
                                            moveTo(sourceId, id);
                                        }
                                        setDraggingId(null);
                                        setDropTargetId(null);
                                    }}
                                    className={cn(
                                        'imcrm-group imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border/40 imcrm-px-4 imcrm-py-2 imcrm-text-sm last:imcrm-border-b-0',
                                        ! gone && 'hover:imcrm-bg-accent/30',
                                        isDragging && 'imcrm-opacity-40',
                                        isDropTarget && 'imcrm-border-t-2 imcrm-border-t-primary',
                                        gone && 'imcrm-opacity-50',
                                    )}
                                >
                                    <span
                                        className={cn(
                                            'imcrm-shrink-0 imcrm-text-muted-foreground',
                                            !gone && 'imcrm-cursor-grab active:imcrm-cursor-grabbing',
                                        )}
                                        aria-hidden
                                    >
                                        <GripVertical className="imcrm-h-4 imcrm-w-4" />
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => toggleVisible(id)}
                                        title={visible ? __('Ocultar') : __('Mostrar')}
                                        className={cn(
                                            'imcrm-shrink-0 imcrm-rounded imcrm-p-1 imcrm-transition-colors',
                                            visible
                                                ? 'imcrm-text-foreground hover:imcrm-bg-muted'
                                                : 'imcrm-text-muted-foreground/50 hover:imcrm-bg-muted hover:imcrm-text-foreground',
                                        )}
                                    >
                                        {visible ? (
                                            <Eye className="imcrm-h-3.5 imcrm-w-3.5" />
                                        ) : (
                                            <EyeOff className="imcrm-h-3.5 imcrm-w-3.5" />
                                        )}
                                    </button>
                                    <span
                                        className={cn(
                                            'imcrm-min-w-0 imcrm-flex-1 imcrm-truncate',
                                            !visible && 'imcrm-text-muted-foreground line-through',
                                        )}
                                    >
                                        {labelFor(id)}
                                    </span>
                                    {typeFor(id) && (
                                        <span className="imcrm-shrink-0 imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-muted-foreground">
                                            {typeFor(id)}
                                        </span>
                                    )}
                                    {gone && (
                                        <span className="imcrm-shrink-0 imcrm-text-[10px] imcrm-text-destructive">
                                            {__('borrado')}
                                        </span>
                                    )}
                                    <div className="imcrm-flex imcrm-shrink-0 imcrm-flex-col imcrm-opacity-0 group-hover:imcrm-opacity-100">
                                        <button
                                            type="button"
                                            onClick={() => moveUp(id)}
                                            title={__('Subir')}
                                            className="imcrm-text-muted-foreground hover:imcrm-text-foreground"
                                        >
                                            <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor" aria-hidden>
                                                <path d="M5 0 L10 6 L0 6 Z" />
                                            </svg>
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => moveDown(id)}
                                            title={__('Bajar')}
                                            className="imcrm-text-muted-foreground hover:imcrm-text-foreground"
                                        >
                                            <svg width="10" height="6" viewBox="0 0 10 6" fill="currentColor" aria-hidden>
                                                <path d="M5 6 L0 0 L10 0 Z" />
                                            </svg>
                                        </button>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>

                    <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-6 imcrm-py-3">
                        <div className="imcrm-flex imcrm-gap-1">
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={resetOrder}
                                className="imcrm-gap-1.5 imcrm-text-xs"
                            >
                                <RotateCcw className="imcrm-h-3 imcrm-w-3" />
                                {__('Reset orden')}
                            </Button>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={resetVisibility}
                                className="imcrm-gap-1.5 imcrm-text-xs"
                            >
                                <RotateCcw className="imcrm-h-3 imcrm-w-3" />
                                {__('Reset visibilidad')}
                            </Button>
                        </div>
                        <div className="imcrm-flex imcrm-gap-2">
                            <Dialog.Close asChild>
                                <Button type="button" variant="outline" size="sm">
                                    {__('Cancelar')}
                                </Button>
                            </Dialog.Close>
                            <Button type="button" size="sm" onClick={handleApply}>
                                {__('Aplicar')}
                            </Button>
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
