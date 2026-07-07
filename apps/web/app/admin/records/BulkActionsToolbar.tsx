import { useState } from 'react';
import { Copy, Pencil, Trash2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { useBulkRecords, useCreateRecord } from '@/hooks/useRecords';
import { api } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { extractFieldOptions } from './fieldOptions';

interface BulkActionsToolbarProps {
    listId: number;
    selectedIds: number[];
    onClear: () => void;
}

/**
 * Barra contextual flotante (estilo ClickUp) que aparece cuando hay
 * registros seleccionados. Posicionada `fixed bottom` centrada en el
 * viewport para que no se entierre al final del contenido.
 *
 * Acciones soportadas:
 *  - Actualizar campo: popover que pide field + valor; corre bulk
 *    update con `{slug: value}` por cada record seleccionado.
 *  - Duplicar: lee cada record con `useRecord` y crea uno nuevo con
 *    los mismos values.
 *  - Eliminar: soft-delete batch (ya existía).
 *  - Limpiar selección: desmarca todo.
 */
export function BulkActionsToolbar({
    listId,
    selectedIds,
    onClear,
}: BulkActionsToolbarProps): JSX.Element | null {
    const bulk = useBulkRecords(listId);

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

            <UpdateFieldAction
                listId={listId}
                selectedIds={selectedIds}
                onDone={onClear}
            />

            <DuplicateAction
                listId={listId}
                selectedIds={selectedIds}
                onDone={onClear}
            />

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
        </div>
    );
}

/**
 * "Actualizar campo": popover con (1) selector de campo, (2) input
 * apropiado al tipo del campo, (3) botón "Aplicar" que dispara bulk
 * update. Cubre los casos comunes (estado, fecha, etiqueta, número).
 *
 * Tipos no editables inline (relation, file, computed) se filtran de
 * la lista de campos seleccionables.
 */
function UpdateFieldAction({
    listId,
    selectedIds,
    onDone,
}: {
    listId: number;
    selectedIds: number[];
    onDone: () => void;
}): JSX.Element {
    const fields = useFields(listId);
    const bulk = useBulkRecords(listId);
    const [open, setOpen] = useState(false);
    const [fieldSlug, setFieldSlug] = useState<string>('');
    const [value, setValue] = useState<unknown>('');

    const editableFields = (fields.data ?? []).filter(
        (f) => f.type !== 'relation' && f.type !== 'computed' && f.type !== 'file',
    );
    const selected = editableFields.find((f) => f.slug === fieldSlug) ?? null;

    const apply = async (): Promise<void> => {
        if (selected === null) return;
        await bulk.mutateAsync({
            action: 'update',
            ids: selectedIds,
            values: { [selected.slug]: value },
        });
        setOpen(false);
        setFieldSlug('');
        setValue('');
        onDone();
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="imcrm-gap-1.5">
                    <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Actualizar campo')}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="center" sideOffset={8} className="imcrm-w-72 imcrm-p-3">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <Label className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Campo')}
                    </Label>
                    <Select
                        value={fieldSlug}
                        onChange={(e) => {
                            setFieldSlug(e.target.value);
                            // Reset value cuando cambia el field para
                            // que no se quede un value de un tipo
                            // anterior.
                            setValue('');
                        }}
                    >
                        <option value="">{__('— Selecciona —')}</option>
                        {editableFields.map((f) => (
                            <option key={f.id} value={f.slug}>
                                {f.label}
                            </option>
                        ))}
                    </Select>

                    {selected && (
                        <>
                            <Label className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Nuevo valor')}
                            </Label>
                            <BulkValueInput
                                field={selected}
                                value={value}
                                onChange={setValue}
                            />
                        </>
                    )}

                    <Button
                        onClick={apply}
                        disabled={selected === null || bulk.isPending}
                        size="sm"
                        className="imcrm-mt-2"
                    >
                        {bulk.isPending ? __('Aplicando…') : __('Aplicar')}
                    </Button>
                    <p className="imcrm-text-[10px] imcrm-text-muted-foreground">
                        {sprintf(
                            _n(
                                'Se actualizará %d registro.',
                                'Se actualizarán %d registros.',
                                selectedIds.length,
                            ),
                            selectedIds.length,
                        )}
                    </p>
                </div>
            </PopoverContent>
        </Popover>
    );
}

/**
 * Input apropiado al tipo del field para el bulk-update. Subset
 * minimal de FilterValueInput: text, number, date, checkbox,
 * select. Para multi_select acepta CSV.
 */
function BulkValueInput({
    field,
    value,
    onChange,
}: {
    field: FieldEntity;
    value: unknown;
    onChange: (v: unknown) => void;
}): JSX.Element {
    if (field.type === 'select') {
        const options = extractFieldOptions(field);
        return (
            <Select
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange(e.target.value)}
            >
                <option value="">{__('Selecciona…')}</option>
                {options.map((o) => (
                    <option key={o.value} value={o.value}>
                        {o.label}
                    </option>
                ))}
            </Select>
        );
    }
    if (field.type === 'multi_select') {
        const text = Array.isArray(value)
            ? value.join(', ')
            : (typeof value === 'string' ? value : '');
        return (
            <Input
                value={text}
                onChange={(e) =>
                    onChange(e.target.value.split(',').map((s) => s.trim()).filter(Boolean))
                }
                placeholder={__('opt1, opt2, …')}
            />
        );
    }
    if (field.type === 'checkbox') {
        return (
            <Select
                value={value === true || value === '1' ? '1' : '0'}
                onChange={(e) => onChange(e.target.value === '1')}
            >
                <option value="1">{__('Marcado')}</option>
                <option value="0">{__('No marcado')}</option>
            </Select>
        );
    }
    if (field.type === 'date') {
        return (
            <Input
                type="date"
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange(e.target.value)}
            />
        );
    }
    if (field.type === 'datetime') {
        return (
            <Input
                type="datetime-local"
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange(e.target.value)}
            />
        );
    }
    if (field.type === 'number' || field.type === 'currency' || field.type === 'user') {
        return (
            <Input
                type="number"
                step="any"
                value={value === null || value === undefined ? '' : String(value)}
                onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
            />
        );
    }
    return (
        <Input
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder={__('Nuevo valor')}
        />
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
