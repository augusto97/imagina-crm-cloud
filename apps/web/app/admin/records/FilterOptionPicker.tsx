import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, Loader2, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import type { FieldOption } from './fieldOptions';
import { OptionChip } from './renderCellValue';

export interface FilterPickerAction {
    key: string;
    label: ReactNode;
    onSelect: () => void;
}

interface FilterOptionPickerProps {
    options: FieldOption[];
    /** `single`: value es string|null. `multi`: value es string[]. */
    mode: 'single' | 'multi';
    value: string | string[] | null | undefined;
    onChange: (next: string | string[] | null) => void;
    placeholder?: string;
    /**
     * Búsqueda EXTERNA: el llamador filtra/carga `options` con el texto
     * (miembros por el servidor). Sin esto, el picker filtra las opciones
     * localmente por etiqueta o valor.
     */
    onSearch?: (q: string) => void;
    loading?: boolean;
    /** Texto de la lista vacía sin búsqueda ("Escribí para buscar…"). */
    emptyHint?: string;
    /** Etiqueta para un valor elegido que NO está entre las opciones. */
    resolveLabel?: (value: string) => ReactNode;
    /** Accesos directos arriba de la lista (p. ej. "Yo"). */
    actions?: FilterPickerAction[];
    'aria-label'?: string;
    'data-testid'?: string;
}

const norm = (s: string): string =>
    s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * v0.1.191 — picker de opciones para el lado "valor" de un filtro. Es lo
 * que ClickUp abre en "es alguno de": una lista con casillas, chips de
 * color y buscador — en vez del cuadro de texto donde había que tipear los
 * `value` internos a mano, separados por coma.
 *
 * Dropdown PLANO (sin portal), igual que `AutocompleteInput` (v0.1.85): un
 * Popover de Radix acá adentro vive dentro de OTRO popover (el panel de
 * Filtros, el de edición masiva) y se auto-descartaba por el juego de capas
 * anidadas. Un div absoluto dentro del propio contenedor no participa de
 * ese sistema y sobrevive.
 */
export function FilterOptionPicker({
    options,
    mode,
    value,
    onChange,
    placeholder,
    onSearch,
    loading = false,
    emptyHint,
    resolveLabel,
    actions,
    'aria-label': ariaLabel,
    'data-testid': testId,
}: FilterOptionPickerProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const [highlight, setHighlight] = useState(0);
    const containerRef = useRef<HTMLDivElement>(null);

    const selected: string[] = mode === 'multi'
        ? (Array.isArray(value) ? value.map(String) : [])
        : (typeof value === 'string' && value !== '' ? [value] : []);
    const selectedSet = new Set(selected);

    const q = norm(search);
    const filtered = onSearch || q === ''
        ? options
        : options.filter((o) => norm(o.label).includes(q) || norm(o.value).includes(q));

    // Click afuera → cerrar. `mousedown` (no `click`): así el botón que se
    // pulsa afuera recibe su propio click sin que el cierre se lo coma.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent): void => {
            if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);

    // Escape cierra SOLO el picker. El panel que lo aloja (un Popover de
    // Radix) escucha Escape en el `document` en fase de captura, así que un
    // stopPropagation en el handler de React llega tarde; en `window` la
    // captura corre ANTES que la del document y el panel no se entera.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key !== 'Escape') return;
            e.stopPropagation();
            e.preventDefault();
            setOpen(false);
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [open]);

    useEffect(() => {
        if (!open) {
            setSearch('');
            setHighlight(0);
            onSearch?.('');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al abrir/cerrar
    }, [open]);

    useEffect(() => {
        setHighlight(0);
    }, [search]);

    const pick = (opt: FieldOption): void => {
        if (mode === 'single') {
            // Toggle: la opción ya elegida se des-selecciona (estilo ClickUp).
            onChange(selectedSet.has(opt.value) ? null : opt.value);
            setOpen(false);
            return;
        }
        onChange(
            selectedSet.has(opt.value)
                ? selected.filter((v) => v !== opt.value)
                : [...selected, opt.value],
        );
        // En multi el dropdown queda abierto para marcar varias.
    };

    const remove = (v: string): void => {
        if (mode === 'single') onChange(null);
        else onChange(selected.filter((x) => x !== v));
    };

    const chipFor = (v: string): ReactNode => {
        const opt = options.find((o) => o.value === v);
        return <OptionChip opt={opt} fallback={v} />;
    };

    const onKeyDown = (e: React.KeyboardEvent): void => {
        if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            return;
        }
        if (!open) {
            if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setOpen(true);
            }
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlight((h) => Math.max(0, h - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const opt = filtered[highlight] ?? filtered[0];
            if (opt) pick(opt);
        }
    };

    const showSearch = onSearch !== undefined || options.length > 6;

    return (
        <div ref={containerRef} className="imcrm-relative imcrm-w-full" data-testid={testId}>
            <button
                type="button"
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                onKeyDown={onKeyDown}
                className={cn(
                    'imcrm-flex imcrm-min-h-9 imcrm-w-full imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-py-1 imcrm-text-left imcrm-text-sm imcrm-transition-colors hover:imcrm-border-primary/40',
                    open && 'imcrm-border-primary/60 imcrm-ring-1 imcrm-ring-primary/30',
                )}
            >
                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-wrap imcrm-items-center imcrm-gap-1">
                    {selected.length === 0 ? (
                        <span className="imcrm-text-muted-foreground">
                            {placeholder ?? (mode === 'multi' ? __('Elegir opciones…') : __('Elegir…'))}
                        </span>
                    ) : (
                        selected.map((v) => (
                            <span key={v} className="imcrm-inline-flex imcrm-max-w-full imcrm-items-center imcrm-gap-0.5">
                                {resolveLabel && !options.some((o) => o.value === v)
                                    ? (
                                        <span className="imcrm-inline-flex imcrm-max-w-full imcrm-items-center imcrm-truncate imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted imcrm-px-2 imcrm-py-0.5 imcrm-text-[12px] imcrm-font-medium">
                                            {resolveLabel(v)}
                                        </span>
                                    )
                                    : chipFor(v)}
                                {mode === 'multi' && (
                                    <span
                                        role="button"
                                        tabIndex={-1}
                                        aria-label={__('Quitar')}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            remove(v);
                                        }}
                                        className="imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                    >
                                        <X className="imcrm-h-3 imcrm-w-3" />
                                    </span>
                                )}
                            </span>
                        ))
                    )}
                </span>
                <ChevronDown className="imcrm-ml-auto imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
            </button>

            {open && (
                <div
                    className="imcrm-absolute imcrm-left-0 imcrm-right-0 imcrm-top-full imcrm-z-50 imcrm-mt-1 imcrm-min-w-[220px] imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-popover imcrm-text-popover-foreground imcrm-shadow-md"
                    data-testid={testId ? `${testId}-list` : undefined}
                >
                    {showSearch && (
                        <div className="imcrm-border-b imcrm-border-border imcrm-p-1.5">
                            <Input
                                autoFocus
                                value={search}
                                onChange={(e) => {
                                    setSearch(e.target.value);
                                    onSearch?.(e.target.value);
                                }}
                                onKeyDown={onKeyDown}
                                placeholder={__('Buscar…')}
                                className="imcrm-h-7 imcrm-text-sm"
                                aria-label={__('Buscar opción')}
                            />
                        </div>
                    )}
                    <ul className="imcrm-max-h-56 imcrm-overflow-y-auto imcrm-py-1" role="listbox" aria-multiselectable={mode === 'multi'}>
                        {actions?.map((a) => (
                            <li key={a.key}>
                                <button
                                    type="button"
                                    onClick={() => {
                                        a.onSelect();
                                        if (mode === 'single') setOpen(false);
                                    }}
                                    className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm imcrm-text-primary hover:imcrm-bg-accent/40"
                                >
                                    {a.label}
                                </button>
                            </li>
                        ))}
                        {loading && filtered.length === 0 ? (
                            <li className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                                <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                                {__('Buscando…')}
                            </li>
                        ) : filtered.length === 0 ? (
                            <li className="imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                                {q === '' && emptyHint ? emptyHint : q === '' ? __('Sin opciones.') : __('Sin resultados.')}
                            </li>
                        ) : (
                            filtered.map((opt, i) => {
                                const isSelected = selectedSet.has(opt.value);
                                return (
                                    <li key={opt.value}>
                                        <button
                                            type="button"
                                            role="option"
                                            aria-selected={isSelected}
                                            data-highlighted={i === highlight ? '' : undefined}
                                            onMouseEnter={() => setHighlight(i)}
                                            onClick={() => pick(opt)}
                                            className={cn(
                                                'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm',
                                                i === highlight ? 'imcrm-bg-accent' : 'hover:imcrm-bg-accent/40',
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
                                            <OptionChip opt={opt} fallback={opt.value} />
                                            {mode === 'single' && isSelected && (
                                                <Check className="imcrm-ml-auto imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" />
                                            )}
                                        </button>
                                    </li>
                                );
                            })
                        )}
                    </ul>
                </div>
            )}
        </div>
    );
}
