import { useEffect, useRef, useState } from 'react';

import {
    Popover,
    PopoverAnchor,
    PopoverContent,
} from '@/components/ui/popover';
import {
    useFieldDistinctValues,
    type FieldDistinctValue,
} from '@/hooks/useFields';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { Input } from './input';

/**
 * Input de texto con dropdown de sugerencias auto-completables —
 * los valores los provee el endpoint `/fields/{field}/values` (top
 * 50 valores existentes en esa columna ordenados por frecuencia).
 *
 * Diseñado para reemplazar `<Input>` plano en value pickers de:
 *  - Filtros de la vista records (`FilterPopover`)
 *  - Conditions de triggers / actions (`TriggerConfigEditor`,
 *    `ActionConditionEditor`, `IfElseConfig`)
 *  - Pares slug=valor de `update_field`
 *
 * Si `listId` o `fieldId` son undefined (ej. el usuario aún no eligió
 * el campo), se comporta como un Input normal sin sugerencias.
 *
 * UX:
 *  - Click / focus → abre el popover con las top 50 sugerencias
 *  - Escribir → filtra server-side via `?search=`
 *  - Click en sugerencia → setea valor y cierra
 *  - Escape o blur → cierra
 *  - Flechas ↑↓ navegan, Enter selecciona el highlighted
 */
interface AutocompleteInputProps {
    listId: number | string | undefined;
    fieldId: number | string | undefined;
    value: string;
    onChange: (next: string) => void;
    placeholder?: string;
    type?: 'text' | 'number';
    className?: string;
    disabled?: boolean;
    'aria-label'?: string;
}

export function AutocompleteInput({
    listId,
    fieldId,
    value,
    onChange,
    placeholder,
    type = 'text',
    className,
    disabled,
    'aria-label': ariaLabel,
}: AutocompleteInputProps): JSX.Element {
    const [open, setOpen]             = useState(false);
    const [highlighted, setHighlight] = useState<number>(-1);
    const containerRef                = useRef<HTMLDivElement>(null);

    const enabled = open && !!fieldId && !disabled;
    const query   = useFieldDistinctValues(listId, fieldId, value, enabled);

    const suggestions: FieldDistinctValue[] = query.data ?? [];

    // Reset highlight cuando cambian las sugerencias.
    useEffect(() => {
        setHighlight(-1);
    }, [suggestions.length, value]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
        if (!open) {
            if (e.key === 'ArrowDown') {
                setOpen(true);
                e.preventDefault();
            }
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
        } else if (e.key === 'Enter' && highlighted >= 0) {
            const sel = suggestions[highlighted];
            if (sel) {
                e.preventDefault();
                onChange(sel.value);
                setOpen(false);
            }
        } else if (e.key === 'Escape') {
            setOpen(false);
        }
    };

    const showError   = open && fieldId && query.isError;
    const showHelp    = open && fieldId && !query.isFetching && !query.isError && suggestions.length === 0;

    return (
        <div ref={containerRef} className={cn('imcrm-relative', className)}>
            <Popover open={open && fieldId !== undefined} onOpenChange={setOpen}>
                <PopoverAnchor asChild>
                    <Input
                        type={type}
                        value={value}
                        onChange={(e) => {
                            onChange(e.target.value);
                            setOpen(true);
                        }}
                        onFocus={() => setOpen(true)}
                        onBlur={() => {
                            // Delay para permitir el click en una sugerencia
                            // antes de cerrar.
                            window.setTimeout(() => setOpen(false), 120);
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        aria-label={ariaLabel}
                        aria-autocomplete="list"
                        aria-expanded={open}
                        disabled={disabled}
                        autoComplete="off"
                    />
                </PopoverAnchor>
                <PopoverContent
                    align="start"
                    sideOffset={4}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    className="imcrm-w-[var(--radix-popover-trigger-width)] imcrm-min-w-[200px] imcrm-p-0"
                >
                    {showError ? (
                        <div className="imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-destructive">
                            {__('No se pudieron cargar las sugerencias.')}{' '}
                            <span className="imcrm-text-muted-foreground">
                                {query.error instanceof Error ? query.error.message : ''}
                            </span>
                        </div>
                    ) : query.isFetching && suggestions.length === 0 ? (
                        <div className="imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Buscando…')}
                        </div>
                    ) : showHelp ? (
                        <div className="imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                            {value === ''
                                ? __('Aún no hay valores en este campo.')
                                : __('Sin coincidencias — el valor que escribas se guardará tal cual.')}
                        </div>
                    ) : (
                        <ul className="imcrm-max-h-64 imcrm-overflow-y-auto imcrm-py-1">
                            {suggestions.map((s, i) => (
                                <li key={`${s.value}-${i}`}>
                                    <button
                                        type="button"
                                        onMouseDown={(e) => {
                                            // mousedown no triggers blur del
                                            // input antes que onClick.
                                            e.preventDefault();
                                            onChange(s.value);
                                            setOpen(false);
                                        }}
                                        onMouseEnter={() => setHighlight(i)}
                                        className={cn(
                                            'imcrm-flex imcrm-w-full imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-text-sm',
                                            highlighted === i
                                                ? 'imcrm-bg-accent imcrm-text-accent-foreground'
                                                : 'hover:imcrm-bg-accent/50',
                                        )}
                                    >
                                        <span className="imcrm-truncate">{s.value}</span>
                                        <span className="imcrm-shrink-0 imcrm-rounded-full imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-medium imcrm-text-muted-foreground">
                                            {s.count}
                                        </span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </PopoverContent>
            </Popover>
        </div>
    );
}
