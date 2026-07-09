import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useFields } from '@/hooks/useFields';
import { useUpdateSavedView } from '@/hooks/useSavedViews';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { SavedViewEntity } from '@/types/view';

import { CardsConfigPanel } from './CardsConfigPanel';

interface EditCardsViewDialogProps {
    listId: number;
    view: SavedViewEntity;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

/**
 * Dialog para editar config de una vista Cards existente
 * (Fase 12.C). El SaveViewDialog solo soporta create — este
 * componente reutiliza el `CardsConfigPanel` para el shape de
 * edición y hace `PATCH` en lugar de `POST`.
 *
 * El nombre también es editable. El tipo NO (cambiar tipo es
 * efectivamente borrar y crear, mejor pasar por ese flow).
 */
export function EditCardsViewDialog({
    listId,
    view,
    open,
    onOpenChange,
}: EditCardsViewDialogProps): JSX.Element {
    const update = useUpdateSavedView(listId);
    const fields = useFields(listId);

    const [name, setName] = useState(view.name);
    const [cardFieldIds, setCardFieldIds] = useState<number[]>(view.config.card_field_ids ?? []);
    const [coverFieldId, setCoverFieldId] = useState<number>(view.config.card_cover_field_id ?? 0);
    const [size, setSize] = useState<'compact' | 'comfortable' | 'spacious'>(
        view.config.card_size ?? 'comfortable',
    );
    const [error, setError] = useState<string | null>(null);

    // Re-init desde la vista al abrir, o cuando se cambia el view target.
    // IMPORTANTE: las deps son `[open, view.id]` — NO `view` ni `update`.
    // `view` y `update` cambian de referencia en cada render del padre
    // (TanStack Query rebuilda objects) → el efecto se dispararía tras
    // cada click del usuario, RESETEANDO el state (los checkboxes
    // marcados se vuelven a deseleccionar, los selects se resetean al
    // valor inicial). Por eso solo dependemos del id del view + open.
    useEffect(() => {
        if (! open) return;
        setName(view.name);
        setCardFieldIds(view.config.card_field_ids ?? []);
        setCoverFieldId(view.config.card_cover_field_id ?? 0);
        setSize(view.config.card_size ?? 'comfortable');
        setError(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, view.id]);

    // Reset del mutation al cerrar — separado del init para no
    // contaminar las deps de arriba.
    useEffect(() => {
        if (! open) update.reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);
        try {
            await update.mutateAsync({
                id: view.id,
                name: name.trim() || view.name,
                config: {
                    card_field_ids: cardFieldIds,
                    ...(coverFieldId > 0 ? { card_cover_field_id: coverFieldId } : {}),
                    card_size: size,
                },
            });
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg',
                    )}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {__('Editar vista Cards')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Cambios al nombre y configuración de la tarjeta.')}
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
                            <Label htmlFor="cards-edit-name">{__('Nombre')}</Label>
                            <Input
                                id="cards-edit-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                autoFocus
                            />
                        </div>

                        <CardsConfigPanel
                            fields={fields.data ?? []}
                            cardFieldIds={cardFieldIds}
                            onCardFieldIdsChange={setCardFieldIds}
                            coverFieldId={coverFieldId}
                            onCoverFieldIdChange={setCoverFieldId}
                            size={size}
                            onSizeChange={setSize}
                        />

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
