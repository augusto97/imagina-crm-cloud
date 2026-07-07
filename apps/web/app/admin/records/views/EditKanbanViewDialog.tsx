import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowDown, ArrowUp, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFields } from '@/hooks/useFields';
import { useUpdateSavedView } from '@/hooks/useSavedViews';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { SavedViewEntity } from '@/types/view';

interface EditKanbanViewDialogProps {
    listId: number;
    view: SavedViewEntity;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/** Tipos válidos para `group_by_field_id` en Kanban (select con opciones). */
const GROUP_BY_TYPES = ['select'] as const;

/**
 * Edit dialog para vistas Kanban. Permite ajustar:
 *  - Nombre.
 *  - Campo de agrupación (debe ser `select`).
 *  - Campo de título de cada card.
 *  - Campos meta (máx 4, reordenables).
 *
 * Mismo patrón que `EditCardsViewDialog` pero con field set específico
 * de Kanban. CRÍTICO: el `useEffect` de re-init solo depende de
 * `[open, view.id]` — no de `view` ni `update` (objetos que cambian
 * de referencia cada render → resetearían el state en cada click).
 */
export function EditKanbanViewDialog({
    listId,
    view,
    open,
    onOpenChange,
}: EditKanbanViewDialogProps): JSX.Element {
    const update = useUpdateSavedView(listId);
    const fields = useFields(listId);

    const [name, setName] = useState(view.name);
    const [groupByFieldId, setGroupByFieldId] = useState<number>(
        view.config.group_by_field_id ?? 0,
    );
    const [titleFieldId, setTitleFieldId] = useState<number>(
        view.config.kanban_title_field_id ?? 0,
    );
    const [metaFieldIds, setMetaFieldIds] = useState<number[]>(
        view.config.kanban_meta_field_ids ?? [],
    );
    const [error, setError] = useState<string | null>(null);

    // IMPORTANTE: deps son [open, view.id] solamente. `view` y `update`
    // cambian de referencia cada render → resetearían los checkboxes
    // marcados por el usuario.
    useEffect(() => {
        if (! open) return;
        setName(view.name);
        setGroupByFieldId(view.config.group_by_field_id ?? 0);
        setTitleFieldId(view.config.kanban_title_field_id ?? 0);
        setMetaFieldIds(view.config.kanban_meta_field_ids ?? []);
        setError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, view.id]);

    useEffect(() => {
        if (! open) update.reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        if (groupByFieldId === 0) {
            setError(__('El campo de agrupación es obligatorio para Kanban.'));
            return;
        }
        try {
            await update.mutateAsync({
                id: view.id,
                name: name.trim() || view.name,
                config: {
                    ...view.config,
                    group_by_field_id: groupByFieldId,
                    ...(titleFieldId > 0
                        ? { kanban_title_field_id: titleFieldId }
                        : {}),
                    kanban_meta_field_ids: metaFieldIds,
                },
            });
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    const allFields = fields.data ?? [];
    const groupByCandidates = allFields.filter((f) =>
        (GROUP_BY_TYPES as readonly string[]).includes(f.type),
    );
    const titleCandidates = allFields.filter(
        (f) => f.id !== groupByFieldId && (f.type === 'text' || f.type === 'email' || f.is_primary),
    );
    const metaCandidates = allFields.filter(
        (f) =>
            f.id !== groupByFieldId &&
            f.id !== titleFieldId &&
            f.type !== 'long_text' &&
            f.type !== 'file' &&
            f.type !== 'relation',
    );

    const toggleMeta = (id: number): void => {
        setMetaFieldIds((prev) =>
            prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
        );
    };
    const moveMeta = (id: number, dir: -1 | 1): void => {
        setMetaFieldIds((prev) => {
            const idx = prev.indexOf(id);
            const target = idx + dir;
            if (idx < 0 || target < 0 || target >= prev.length) return prev;
            const next = [...prev];
            [next[idx], next[target]] = [next[target]!, next[idx]!];
            return next;
        });
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-full imcrm-max-w-md',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg',
                        'imcrm-max-h-[85vh] imcrm-overflow-y-auto',
                    )}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {__('Editar vista Kanban')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Agrupación, título y campos visibles en cada card.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <form onSubmit={handleSubmit} className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-4">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="kanban-name">{__('Nombre')}</Label>
                            <Input
                                id="kanban-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                autoFocus
                            />
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="kanban-groupby">{__('Agrupar por')}</Label>
                            <select
                                id="kanban-groupby"
                                value={groupByFieldId}
                                onChange={(e) => setGroupByFieldId(Number(e.target.value))}
                                className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                            >
                                <option value="0">{__('— Elegir campo —')}</option>
                                {groupByCandidates.map((f) => (
                                    <option key={f.id} value={f.id}>{f.label}</option>
                                ))}
                            </select>
                            {groupByCandidates.length === 0 && (
                                <p className="imcrm-text-[11px] imcrm-text-warning">
                                    {__('Necesitás un campo tipo "Select" para agrupar.')}
                                </p>
                            )}
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="kanban-title">{__('Título de la card')}</Label>
                            <select
                                id="kanban-title"
                                value={titleFieldId}
                                onChange={(e) => setTitleFieldId(Number(e.target.value))}
                                className="imcrm-h-9 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                            >
                                <option value="0">{__('Automático (primary o primer texto)')}</option>
                                {titleCandidates.map((f) => (
                                    <option key={f.id} value={f.id}>{f.label} ({f.type})</option>
                                ))}
                            </select>
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label>{__('Campos visibles en la card')}</Label>
                            {metaFieldIds.length > 0 && (
                                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-p-2">
                                    {metaFieldIds.map((id, i) => {
                                        const f = allFields.find((x) => x.id === id);
                                        return (
                                            <li
                                                key={id}
                                                className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-bg-card imcrm-px-2 imcrm-py-1 imcrm-text-xs"
                                            >
                                                <span className="imcrm-flex-1 imcrm-truncate">
                                                    {f ? f.label : `#${id}`}
                                                    {f && (
                                                        <span className="imcrm-ml-1 imcrm-text-[10px] imcrm-text-muted-foreground">
                                                            ({f.type})
                                                        </span>
                                                    )}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => moveMeta(id, -1)}
                                                    disabled={i === 0}
                                                    className="imcrm-text-muted-foreground hover:imcrm-text-foreground disabled:imcrm-opacity-30"
                                                    title={__('Subir')}
                                                >
                                                    <ArrowUp className="imcrm-h-3 imcrm-w-3" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => moveMeta(id, 1)}
                                                    disabled={i === metaFieldIds.length - 1}
                                                    className="imcrm-text-muted-foreground hover:imcrm-text-foreground disabled:imcrm-opacity-30"
                                                    title={__('Bajar')}
                                                >
                                                    <ArrowDown className="imcrm-h-3 imcrm-w-3" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => toggleMeta(id)}
                                                    className="imcrm-text-muted-foreground hover:imcrm-text-destructive"
                                                    title={__('Quitar')}
                                                >
                                                    <X className="imcrm-h-3 imcrm-w-3" />
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-1.5">
                                {metaCandidates
                                    .filter((f) => ! metaFieldIds.includes(f.id))
                                    .map((f) => (
                                        <button
                                            key={f.id}
                                            type="button"
                                            onClick={() => toggleMeta(f.id)}
                                            className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-2 imcrm-py-1 imcrm-text-left imcrm-text-xs hover:imcrm-border-primary hover:imcrm-bg-accent/40"
                                        >
                                            <span className="imcrm-truncate">+ {f.label}</span>
                                        </button>
                                    ))}
                            </div>
                        </div>

                        {error !== null && (
                            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                                {error}
                            </div>
                        )}

                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Dialog.Close asChild>
                                <Button type="button" variant="outline">
                                    {__('Cancelar')}
                                </Button>
                            </Dialog.Close>
                            <Button type="submit" disabled={update.isPending}>
                                {update.isPending ? __('Guardando…') : __('Guardar cambios')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
