import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Loader2, User as UserIcon, X } from 'lucide-react';

import { Input } from '@/components/ui/input';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { useWpUser, useWpUsersSearch, type WpUserSummary } from '@/hooks/useWpUsers';
import { getBootData } from '@/lib/boot';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface UserPickerProps {
    /** ID del WP user actualmente seleccionado, o null/undefined si vacío. */
    value: number | null | undefined;
    onChange: (id: number | null) => void;
    placeholder?: string;
    /** Visible variant — trigger inline más pequeño (para CompactFieldRow). */
    compact?: boolean;
    disabled?: boolean;
    /**
     * Si true, ofrece "Asignar a mí" en el footer del popover. Pone el
     * ID del usuario actual (cookie/nonce). Requiere que `window.imcrm.me`
     * esté disponible — si no, oculta el botón.
     */
    showAssignMe?: boolean;
}

/**
 * Picker de usuarios WP con autocomplete por nombre/login. Reemplaza
 * el `<Input type="number">` crudo que tenía el field type `user`.
 *
 * Cuando hay valor seleccionado: muestra avatar + display_name + login
 * + botón X para limpiar.
 * Cuando no hay valor: muestra placeholder y al click abre popover.
 *
 * El popover tiene un input de búsqueda con debounce 200ms; resultados
 * via `useWpUsersSearch`. Selección con teclado (↑/↓/Enter/Escape) o
 * mouse. Cierre on Escape, on selección, o al click fuera.
 */
export function UserPicker({
    value,
    onChange,
    placeholder,
    compact,
    disabled,
    showAssignMe,
}: UserPickerProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [debounced, setDebounced] = useState('');
    const [highlight, setHighlight] = useState(0);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const currentUser = useWpUser(value ?? null);
    const search = useWpUsersSearch(debounced, 8);

    // Debounce: 200ms tras la última pulsación.
    useEffect(() => {
        if (debounceRef.current !== null) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => setDebounced(query), 200);
        return () => {
            if (debounceRef.current !== null) clearTimeout(debounceRef.current);
        };
    }, [query]);

    // Reset query/highlight al cerrar.
    useEffect(() => {
        if (!open) {
            setQuery('');
            setDebounced('');
            setHighlight(0);
        }
    }, [open]);

    const hits = search.data ?? [];

    const pick = (user: WpUserSummary): void => {
        onChange(user.id);
        setOpen(false);
    };

    const clear = (e: React.MouseEvent): void => {
        e.stopPropagation();
        onChange(null);
    };

    // ID del usuario logueado (boot data). Si no hay (sesión expirada
    // o boot fallback), el botón "Asignar a mí" no se muestra.
    const meId = showAssignMe ? getBootData().user.id || null : null;

    return (
        <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={disabled}
                    className={cn(
                        'imcrm-inline-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-text-left imcrm-text-sm imcrm-transition-colors',
                        compact ? 'imcrm-h-8 imcrm-px-2' : 'imcrm-h-9 imcrm-px-3',
                        !disabled && 'hover:imcrm-border-primary/40',
                        disabled && 'imcrm-cursor-not-allowed imcrm-opacity-60',
                    )}
                >
                    {currentUser.data ? (
                        <UserChip
                            user={currentUser.data}
                            compact={compact}
                            onClear={!disabled ? clear : undefined}
                        />
                    ) : value && currentUser.isLoading ? (
                        <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                            {__('Cargando…')}
                        </span>
                    ) : value && !currentUser.data ? (
                        <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-muted-foreground">
                            <UserIcon className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Usuario')} #{value}
                            <span className="imcrm-text-[10px]">({__('borrado')})</span>
                        </span>
                    ) : (
                        <span className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-gap-1.5 imcrm-text-muted-foreground">
                            <UserIcon className="imcrm-h-3.5 imcrm-w-3.5" />
                            {placeholder ?? __('Asignar usuario…')}
                        </span>
                    )}
                    <ChevronDown className="imcrm-ml-auto imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                </button>
            </PopoverTrigger>

            <PopoverContent align="start" sideOffset={4} className="imcrm-w-72 imcrm-p-0">
                <div className="imcrm-border-b imcrm-border-border imcrm-p-2">
                    <Input
                        autoFocus
                        value={query}
                        onChange={(e) => {
                            setQuery(e.target.value);
                            setHighlight(0);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setHighlight((h) => Math.min(h + 1, Math.max(0, hits.length - 1)));
                            } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setHighlight((h) => Math.max(0, h - 1));
                            } else if (e.key === 'Enter') {
                                e.preventDefault();
                                const pickedHit = hits[highlight] ?? hits[0];
                                if (pickedHit) pick(pickedHit);
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setOpen(false);
                            }
                        }}
                        placeholder={__('Buscar por nombre o usuario…')}
                        className="imcrm-h-8 imcrm-text-sm"
                    />
                </div>

                <ul className="imcrm-max-h-64 imcrm-overflow-y-auto imcrm-py-1" role="listbox">
                    {search.isFetching && debounced !== '' ? (
                        <li className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                            {__('Buscando…')}
                        </li>
                    ) : hits.length === 0 ? (
                        <li className="imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                            {debounced === ''
                                ? __('Escribí para buscar usuarios.')
                                : __('Sin resultados.')}
                        </li>
                    ) : (
                        hits.map((user, i) => (
                            <li key={user.id}>
                                <button
                                    type="button"
                                    role="option"
                                    aria-selected={i === highlight}
                                    onMouseEnter={() => setHighlight(i)}
                                    onClick={() => pick(user)}
                                    className={cn(
                                        'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-text-sm',
                                        i === highlight
                                            ? 'imcrm-bg-accent'
                                            : 'hover:imcrm-bg-accent/40',
                                    )}
                                >
                                    <Avatar user={user} />
                                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                                        <span className="imcrm-truncate">
                                            {user.display_name || user.login}
                                        </span>
                                        <span className="imcrm-truncate imcrm-text-[10px] imcrm-text-muted-foreground">
                                            @{user.login}
                                        </span>
                                    </div>
                                </button>
                            </li>
                        ))
                    )}
                </ul>

                {(meId !== null || value) && (
                    <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-2 imcrm-py-1.5">
                        {meId !== null && meId !== value && (
                            <button
                                type="button"
                                onClick={() => {
                                    onChange(meId);
                                    setOpen(false);
                                }}
                                className="imcrm-text-xs imcrm-text-primary hover:imcrm-underline"
                            >
                                {__('Asignar a mí')}
                            </button>
                        )}
                        {value && (
                            <button
                                type="button"
                                onClick={() => {
                                    onChange(null);
                                    setOpen(false);
                                }}
                                className="imcrm-ml-auto imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-destructive"
                            >
                                {__('Quitar asignación')}
                            </button>
                        )}
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}

// ─── Sub-components ──────────────────────────────────────────────────

function UserChip({
    user,
    compact,
    onClear,
}: {
    user: WpUserSummary;
    compact?: boolean;
    onClear?: (e: React.MouseEvent) => void;
}): JSX.Element {
    return (
        <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-2">
            <Avatar user={user} />
            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                <span className="imcrm-truncate imcrm-text-foreground">
                    {user.display_name || user.login}
                </span>
                {!compact && (
                    <span className="imcrm-truncate imcrm-text-[10px] imcrm-text-muted-foreground">
                        @{user.login}
                    </span>
                )}
            </span>
            {onClear && (
                <button
                    type="button"
                    onClick={onClear}
                    title={__('Quitar')}
                    className="imcrm-ml-auto imcrm-shrink-0 imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                >
                    <X className="imcrm-h-3 imcrm-w-3" />
                </button>
            )}
        </span>
    );
}

function Avatar({ user }: { user: WpUserSummary }): JSX.Element {
    if (user.avatar_url) {
        return (
            <img
                src={user.avatar_url}
                alt=""
                aria-hidden
                className="imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-muted"
            />
        );
    }
    // Fallback: initial char con bg primary tenue.
    const initial = (user.display_name || user.login || '?').charAt(0).toUpperCase();
    return (
        <span
            aria-hidden
            className="imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/15 imcrm-text-[10px] imcrm-font-semibold imcrm-text-primary"
        >
            {initial}
        </span>
    );
}
