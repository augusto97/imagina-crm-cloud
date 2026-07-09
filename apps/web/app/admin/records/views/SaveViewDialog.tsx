import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { useCreateSavedView } from '@/hooks/useSavedViews';
import { ApiError } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { SavedViewConfig, SavedViewEntity, SavedViewType } from '@/types/view';

import { CardsConfigPanel } from './CardsConfigPanel';

interface SaveViewDialogProps {
    listId: number;
    config: SavedViewConfig;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onCreated?: (view: SavedViewEntity) => void;
}

/**
 * Dialog que captura el `config` actual (filters/sort/search) y lo
 * persiste como una nueva vista guardada. Es la UX detrás del botón "+"
 * en `ViewsTabs`.
 */
export function SaveViewDialog({
    listId,
    config,
    open,
    onOpenChange,
    onCreated,
}: SaveViewDialogProps): JSX.Element {
    const create = useCreateSavedView(listId);
    const fields = useFields(listId);
    const [name, setName] = useState('');
    const [setDefault, setSetDefault] = useState(false);
    const [type, setType] = useState<SavedViewType>('table');
    const [groupByFieldId, setGroupByFieldId] = useState<number>(0);
    const [dateFieldId, setDateFieldId] = useState<number>(0);
    const [cardFieldIds, setCardFieldIds] = useState<number[]>([]);
    const [cardCoverFieldId, setCardCoverFieldId] = useState<number>(0);
    const [cardSize, setCardSize] = useState<'compact' | 'comfortable' | 'spacious'>('comfortable');
    const [error, setError] = useState<string | null>(null);

    const selectFields = useMemo(
        () => (fields.data ?? []).filter((f) => f.type === 'select'),
        [fields.data],
    );
    const dateFields = useMemo(
        () => (fields.data ?? []).filter((f) => f.type === 'date' || f.type === 'datetime'),
        [fields.data],
    );

    useEffect(() => {
        if (!open) {
            setName('');
            setSetDefault(false);
            setType('table');
            setGroupByFieldId(0);
            setDateFieldId(0);
            setCardFieldIds([]);
            setCardCoverFieldId(0);
            setCardSize('comfortable');
            setError(null);
            create.reset();
        }
        // Sólo al cambiar `open`. `create` (objeto de mutación de react-query) es
        // una referencia NUEVA en cada render; incluirlo acá disparaba el effect
        // en cada render → `create.reset()` → re-render → loop infinito ("Maximum
        // update depth"). El `reset()` sólo debe correr al cerrar el diálogo.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // Auto-selección al cambiar de tipo: menos clics para el operador.
    useEffect(() => {
        if (type === 'kanban' && groupByFieldId === 0 && selectFields.length > 0) {
            setGroupByFieldId(selectFields[0]!.id);
        }
        if (type === 'calendar' && dateFieldId === 0 && dateFields.length > 0) {
            setDateFieldId(dateFields[0]!.id);
        }
    }, [type, groupByFieldId, dateFieldId, selectFields, dateFields]);

    const handleSubmit = async (e: React.FormEvent): Promise<void> => {
        e.preventDefault();
        setError(null);

        // Para vistas alternativas empacamos el config específico y
        // omitimos filters/sort que pertenecen al state de table.
        const payloadConfig: SavedViewConfig =
            type === 'kanban'
                ? { group_by_field_id: groupByFieldId }
                : type === 'calendar'
                  ? { date_field_id: dateFieldId }
                  : type === 'cards'
                    ? {
                        card_field_ids: cardFieldIds,
                        ...(cardCoverFieldId > 0 ? { card_cover_field_id: cardCoverFieldId } : {}),
                        card_size: cardSize,
                    }
                    : config;

        try {
            const view = await create.mutateAsync({
                name: name.trim(),
                type,
                config: payloadConfig,
                is_default: setDefault,
            });
            onCreated?.(view);
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : 'Error');
        }
    };

    const summary = describeConfig(config);

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay
                    className={cn(
                        'imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm',
                    )}
                />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-full imcrm-max-w-md',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg',
                    )}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {__('Guardar como vista')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {__('Captura los filtros, sort y búsqueda actuales en una vista nombrada.')}
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
                            <Label htmlFor="view-name">{__('Nombre')}</Label>
                            <Input
                                id="view-name"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder={__('Ej. Vencidos esta semana')}
                                autoFocus
                            />
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="view-type">{__('Tipo de vista')}</Label>
                            <Select
                                id="view-type"
                                value={type}
                                onChange={(e) => setType(e.target.value as SavedViewType)}
                            >
                                <option value="table">{__('Tabla')}</option>
                                <option value="kanban" disabled={selectFields.length === 0}>
                                    {selectFields.length === 0
                                        ? __('Kanban (necesitas al menos un campo Select)')
                                        : __('Kanban')}
                                </option>
                                <option value="calendar" disabled={dateFields.length === 0}>
                                    {dateFields.length === 0
                                        ? __('Calendar (necesitas al menos un campo Date o DateTime)')
                                        : __('Calendar')}
                                </option>
                                <option value="cards">{__('Cards (grid de tarjetas)')}</option>
                            </Select>
                        </div>

                        {type === 'kanban' && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="view-group-by">{__('Agrupar por')}</Label>
                                <Select
                                    id="view-group-by"
                                    value={groupByFieldId}
                                    onChange={(e) => setGroupByFieldId(Number(e.target.value))}
                                >
                                    {selectFields.map((f) => (
                                        <option key={f.id} value={f.id}>
                                            {f.label}
                                        </option>
                                    ))}
                                </Select>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Las columnas del tablero serán las opciones de este campo.')}
                                </p>
                            </div>
                        )}

                        {type === 'calendar' && (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label htmlFor="view-date-field">{__('Campo de fecha')}</Label>
                                <Select
                                    id="view-date-field"
                                    value={dateFieldId}
                                    onChange={(e) => setDateFieldId(Number(e.target.value))}
                                >
                                    {dateFields.map((f) => (
                                        <option key={f.id} value={f.id}>
                                            {f.label}
                                        </option>
                                    ))}
                                </Select>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Cada registro aparecerá en el día de este campo.')}
                                </p>
                            </div>
                        )}

                        {type === 'cards' && (
                            <CardsConfigPanel
                                fields={fields.data ?? []}
                                cardFieldIds={cardFieldIds}
                                onCardFieldIdsChange={setCardFieldIds}
                                coverFieldId={cardCoverFieldId}
                                onCoverFieldIdChange={setCardCoverFieldId}
                                size={cardSize}
                                onSizeChange={setCardSize}
                            />
                        )}

                        <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                            <input
                                type="checkbox"
                                checked={setDefault}
                                onChange={(e) => setSetDefault(e.target.checked)}
                            />
                            {__('Establecer como vista por defecto')}
                        </label>

                        {type === 'table' && (
                            <div className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/30 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                                <span className="imcrm-font-medium imcrm-text-foreground">
                                    {__('Se guardará:')}
                                </span>{' '}
                                {summary}
                            </div>
                        )}

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
                            <Button
                                type="submit"
                                disabled={
                                    name.trim() === '' ||
                                    create.isPending ||
                                    (type === 'kanban' && groupByFieldId <= 0) ||
                                    (type === 'calendar' && dateFieldId <= 0)
                                }
                            >
                                {create.isPending ? __('Guardando…') : __('Guardar vista')}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function describeConfig(config: SavedViewConfig): string {
    const parts: string[] = [];
    if (config.filters && config.filters.length > 0) {
        parts.push(
            sprintf(
                /* translators: %d: number of filters */
                _n('%d filtro', '%d filtros', config.filters.length),
                config.filters.length,
            ),
        );
    }
    if (config.sort && config.sort.length > 0) {
        parts.push(
            sprintf(
                /* translators: %d: number of sorted columns */
                _n('%d columna ordenada', '%d columnas ordenadas', config.sort.length),
                config.sort.length,
            ),
        );
    }
    if (config.search && config.search.trim() !== '') {
        parts.push(
            sprintf(
                /* translators: %s: search query */
                __('búsqueda "%s"'),
                config.search,
            ),
        );
    }
    if (config.group_by_field_id) {
        parts.push(__('agrupación activa'));
    }
    if (config.hidden_columns && config.hidden_columns.length > 0) {
        parts.push(
            sprintf(
                /* translators: %d hidden columns */
                _n('%d columna oculta', '%d columnas ocultas', config.hidden_columns.length),
                config.hidden_columns.length,
            ),
        );
    }
    if (parts.length === 0) return __('sin configuración (vista vacía).');
    return parts.join(', ') + '.';
}
