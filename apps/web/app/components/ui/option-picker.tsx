import { useEffect, useState } from 'react';
import { Check, ChevronDown, Loader2, Plus } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { chipSoftStyle, type OptionColor } from '@/components/ui/color-picker';
import { useAppendFieldOption } from '@/hooks/useFields';
import { extractFieldOptions, type FieldOption } from '@/admin/records/fieldOptions';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

interface OptionPickerProps {
    field: FieldEntity;
    listId: number | string;
    /**
     * `single`: para campos tipo `select` — value es string|null.
     * `multi`:  para campos tipo `multi_select` — value es string[].
     */
    mode: 'single' | 'multi';
    value: string | string[] | null;
    onChange: (next: string | string[] | null) => void;
    disabled?: boolean;
    /** Variante visual del trigger. `compact` baja la altura. */
    compact?: boolean;
    /**
     * `cell`: trigger PLANO para celdas de tabla — sin caja/borde ni
     * chevron, mismo layout que la celda en lectura (los chips tal cual,
     * hover accent). Un solo click abre el popover; al elegir en un
     * multi el popover queda abierto para marcar varios.
     */
    variant?: 'default' | 'cell';
}

/**
 * Picker de opción para select/multi_select con búsqueda y creación
 * inline. Estilo Linear / Notion: trigger con chip(s) actuales,
 * popover con input de búsqueda + lista filtrada + footer "+ Crear"
 * cuando lo escrito no matchea ninguna opción.
 *
 * Cuando el user clickea "+ Crear", llama a `POST /lists/{}/fields/{}/options`
 * vía `useAppendFieldOption`. Al success, auto-selecciona la opción
 * recién creada y limpia el search. Errores (duplicado, sin permisos)
 * se muestran inline en el popover.
 */
export function OptionPicker({
    field,
    listId,
    mode,
    value,
    onChange,
    disabled,
    compact,
    variant = 'default',
}: OptionPickerProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [highlight, setHighlight] = useState(0);
    const [error, setError] = useState<string | null>(null);

    const append = useAppendFieldOption(listId);
    const options = extractFieldOptions(field);

    const norm = (s: string): string => s.trim().toLowerCase();
    const q = norm(search);
    const filtered = q === ''
        ? options
        : options.filter(
              (o) => norm(o.value).includes(q) || norm(o.label ?? o.value).includes(q),
          );

    // Detect exact match para decidir si mostrar el botón "+ Crear".
    // Match por label O por value (case-insensitive).
    const hasExactMatch = options.some(
        (o) => norm(o.value) === q || norm(o.label ?? o.value) === q,
    );
    const canCreate = q !== '' && ! hasExactMatch;

    // Reset highlight cuando el search cambia.
    useEffect(() => {
        setHighlight(0);
    }, [search]);

    // Reset state al cerrar.
    useEffect(() => {
        if (! open) {
            setSearch('');
            setHighlight(0);
            setError(null);
        }
    }, [open]);

    const currentSet = new Set<string>(
        mode === 'multi' ? (Array.isArray(value) ? value.map(String) : []) : [],
    );
    const currentSingle = mode === 'single' && typeof value === 'string' ? value : null;

    const pickOption = (opt: FieldOption): void => {
        if (mode === 'single') {
            // Toggle: clickear la opción YA seleccionada la des-selecciona
            // (estilo ClickUp) — así el trigger de celda no necesita la ×.
            onChange(currentSingle === opt.value ? null : opt.value);
            setOpen(false);
        } else {
            const next = currentSet.has(opt.value)
                ? Array.from(currentSet).filter((v) => v !== opt.value)
                : [...currentSet, opt.value];
            onChange(next);
            // Para multi no cerramos — el user puede querer marcar varios.
        }
    };

    const createOption = (): void => {
        if (! canCreate) return;
        setError(null);
        const value = search.trim();
        append.mutate(
            { fieldId: field.id, value, label: value },
            {
                onSuccess: () => {
                    // Auto-selecciona la opción recién creada.
                    if (mode === 'single') {
                        onChange(value);
                        setOpen(false);
                    } else {
                        const next = [...Array.from(currentSet), value];
                        onChange(next);
                        setSearch('');
                    }
                },
                onError: (err) => {
                    setError(
                        err instanceof Error
                            ? err.message
                            : __('No se pudo crear la opción.'),
                    );
                },
            },
        );
    };

    const isCell = variant === 'cell';

    // Layout del trigger según mode + valor actual.
    const triggerContent = (() => {
        if (mode === 'single') {
            if (currentSingle === null || currentSingle === '') {
                return (
                    <span className="imcrm-text-muted-foreground">
                        {isCell ? '—' : __('— Seleccionar —')}
                    </span>
                );
            }
            const opt = options.find((o) => o.value === currentSingle);
            return (
                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-2">
                    <OptionChipDisplay
                        label={opt?.label ?? currentSingle}
                        color={opt?.color as OptionColor | undefined}
                    />
                    {/* Sin × en NINGUNA superficie (feedback del usuario,
                        estilo ClickUp): para limpiar se clickea la opción
                        ya seleccionada en el popover (toggle). */}
                </span>
            );
        }
        // multi: show chips de los seleccionados, o placeholder si vacío.
        if (currentSet.size === 0) {
            return (
                <span className="imcrm-text-muted-foreground">
                    {isCell ? '—' : __('— Seleccionar —')}
                </span>
            );
        }
        return (
            <span className="imcrm-flex imcrm-flex-1 imcrm-flex-wrap imcrm-items-center imcrm-gap-1">
                {Array.from(currentSet).map((v) => {
                    const opt = options.find((o) => o.value === v);
                    return (
                        <OptionChipDisplay
                            key={v}
                            label={opt?.label ?? v}
                            color={opt?.color as OptionColor | undefined}
                        />
                    );
                })}
            </span>
        );
    })();

    return (
        <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={disabled}
                    // En celdas, que el click no burbujee a la fila (que
                    // en la columna primaria abre el modal del registro).
                    onClick={isCell ? (e) => e.stopPropagation() : undefined}
                    className={cn(
                        isCell
                            ? 'imcrm-flex imcrm-w-full imcrm-min-h-[1.5rem] imcrm-items-center imcrm-rounded imcrm-text-left imcrm-text-sm imcrm--mx-1 imcrm-px-1 hover:imcrm-bg-accent/40'
                            : cn(
                                'imcrm-inline-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-text-left imcrm-text-sm imcrm-transition-colors',
                                compact ? 'imcrm-min-h-8 imcrm-px-2 imcrm-py-1' : 'imcrm-min-h-9 imcrm-px-3 imcrm-py-1.5',
                                !disabled && 'hover:imcrm-border-primary/40',
                            ),
                        disabled && 'imcrm-cursor-not-allowed imcrm-opacity-60',
                    )}
                >
                    {triggerContent}
                    {!isCell && (
                        <ChevronDown className="imcrm-ml-auto imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                    )}
                </button>
            </PopoverTrigger>

            <PopoverContent align="start" sideOffset={4} className="imcrm-w-64 imcrm-p-0">
                <div className="imcrm-border-b imcrm-border-border imcrm-p-2">
                    <Input
                        autoFocus
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
                            } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setHighlight((h) => Math.max(0, h - 1));
                            } else if (e.key === 'Enter') {
                                e.preventDefault();
                                // Enter selecciona la opción highlighted; si no
                                // hay match y se puede crear, crea.
                                if (filtered.length > 0) {
                                    const opt = filtered[highlight] ?? filtered[0];
                                    if (opt) pickOption(opt);
                                } else if (canCreate) {
                                    createOption();
                                }
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setOpen(false);
                            }
                        }}
                        placeholder={__('Buscar o crear…')}
                        className="imcrm-h-8 imcrm-text-sm"
                    />
                </div>

                {error !== null && (
                    <div className="imcrm-border-b imcrm-border-destructive/20 imcrm-bg-destructive/5 imcrm-px-3 imcrm-py-1.5 imcrm-text-[11px] imcrm-text-destructive">
                        {error}
                    </div>
                )}

                <ul className="imcrm-max-h-56 imcrm-overflow-y-auto imcrm-py-1" role="listbox">
                    {filtered.length === 0 ? (
                        <li className="imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                            {q === '' ? __('Sin opciones.') : __('Sin resultados.')}
                        </li>
                    ) : (
                        filtered.map((opt, i) => {
                            const isSelected =
                                mode === 'multi'
                                    ? currentSet.has(opt.value)
                                    : currentSingle === opt.value;
                            return (
                                <li key={opt.value}>
                                    <button
                                        type="button"
                                        role="option"
                                        aria-selected={i === highlight}
                                        onMouseEnter={() => setHighlight(i)}
                                        onClick={() => pickOption(opt)}
                                        className={cn(
                                            'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm',
                                            i === highlight
                                                ? 'imcrm-bg-accent'
                                                : 'hover:imcrm-bg-accent/40',
                                        )}
                                    >
                                        {mode === 'multi' && (
                                            <span
                                                className={cn(
                                                    'imcrm-flex imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-border',
                                                    isSelected
                                                        ? 'imcrm-border-primary imcrm-bg-primary imcrm-text-primary-foreground'
                                                        : 'imcrm-border-input',
                                                )}
                                            >
                                                {isSelected && <Check className="imcrm-h-3 imcrm-w-3" />}
                                            </span>
                                        )}
                                        <OptionChipDisplay
                                            label={opt.label ?? opt.value}
                                            color={opt.color as OptionColor | undefined}
                                        />
                                        {mode === 'single' && isSelected && (
                                            <Check className="imcrm-ml-auto imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" />
                                        )}
                                    </button>
                                </li>
                            );
                        })
                    )}
                </ul>

                {canCreate && (
                    <div className="imcrm-border-t imcrm-border-border imcrm-p-1">
                        <button
                            type="button"
                            onClick={createOption}
                            disabled={append.isPending}
                            className={cn(
                                'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm imcrm-text-primary',
                                !append.isPending && 'hover:imcrm-bg-primary/10',
                                append.isPending && 'imcrm-opacity-60',
                            )}
                        >
                            {append.isPending ? (
                                <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                            ) : (
                                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                            )}
                            <span className="imcrm-truncate">
                                {__('Crear')} &ldquo;<span className="imcrm-font-medium">{search.trim()}</span>&rdquo;
                            </span>
                        </button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}

function OptionChipDisplay({
    label,
    color,
}: {
    label: string;
    color: OptionColor | undefined;
}): JSX.Element {
    const style = chipSoftStyle(color);
    // Sin punto/dot: el chip sólido ya lleva el color de la opción.
    return (
        <span
            className="imcrm-inline-flex imcrm-items-center imcrm-rounded-md imcrm-border imcrm-px-2 imcrm-py-0.5 imcrm-text-xs imcrm-font-medium"
            style={style ?? {
                backgroundColor: 'hsl(var(--imcrm-muted))',
                borderColor: 'hsl(var(--imcrm-border))',
                color: 'hsl(var(--imcrm-foreground))',
            }}
        >
            {label}
        </span>
    );
}
