import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AtSign } from 'lucide-react';

import { api } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface UserHit {
    id: number;
    login: string;
    display_name: string;
}

interface MentionAutocompleteProps {
    /** Token actual tras `@` (sin el `@`). Vacío = popover oculto. */
    query: string;
    /**
     * Hint de posicionamiento. `null` = popover oculto. Cuando se
     * provee, el popover flota sobre su contenedor padre `relative`:
     * `top: 'bottom'` lo coloca encima del contenedor (pop-up típico),
     * `top: 'top'` lo coloca debajo (drop-down).
     */
    anchor: { top: 'top' | 'bottom'; left: number } | null;
    onSelect: (user: UserHit) => void;
    onClose: () => void;
}

/**
 * Popover de autocomplete que se muestra cuando el composer detecta
 * `@<token>` con cursor adyacente. Es responsabilidad del padre detectar
 * el token y posicionar el anchor; este componente sólo renderiza la
 * lista y maneja teclado (↑/↓/Enter/Escape).
 */
export function MentionAutocomplete({
    query,
    anchor,
    onSelect,
    onClose,
}: MentionAutocompleteProps): JSX.Element | null {
    const debounced = useDebouncedValue(query, 120);
    const [highlight, setHighlight] = useState(0);

    const search = useQuery({
        queryKey: ['users-search', debounced],
        queryFn: async () => {
            const res = await api.get<UserHit[]>('/me/users-search', {
                query: { q: debounced, limit: 8 },
            });
            return res.data;
        },
        enabled: debounced.length >= 1,
        staleTime: 30 * 1000,
    });

    const hits = search.data ?? [];

    // Reset highlight cuando cambia la query.
    useEffect(() => {
        setHighlight(0);
    }, [debounced]);

    // Teclado global mientras el popover está abierto.
    useEffect(() => {
        if (anchor === null) return;
        const handler = (e: KeyboardEvent): void => {
            // Cmd/Ctrl+Enter es el atajo de submit del composer — no lo
            // interceptamos aunque el popover esté abierto, así el usuario
            // puede mandar el comentario sin tener que cerrar el menú.
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                return;
            }

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlight((h) => Math.min(h + 1, Math.max(0, hits.length - 1)));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlight((h) => Math.max(0, h - 1));
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                if (hits.length === 0) return;
                e.preventDefault();
                const pick = hits[highlight] ?? hits[0]!;
                onSelect(pick);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                onClose();
            }
        };
        window.addEventListener('keydown', handler, true);
        return () => window.removeEventListener('keydown', handler, true);
    }, [anchor, hits, highlight, onSelect, onClose]);

    if (anchor === null) return null;

    const positionStyle =
        anchor.top === 'bottom'
            ? { bottom: 'calc(100% + 4px)', left: anchor.left }
            : { top: 'calc(100% + 4px)', left: anchor.left };

    return (
        <div
            role="listbox"
            aria-label={__('Sugerencias de menciones')}
            className={cn(
                'imcrm-absolute imcrm-z-50 imcrm-w-64 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-md',
            )}
            style={positionStyle}
        >
            {hits.length === 0 ? (
                <p className="imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                    {search.isLoading
                        ? __('Buscando…')
                        : debounced.length === 0
                          ? __('Escribe para buscar usuarios.')
                          : __('Sin resultados.')}
                </p>
            ) : (
                <ul className="imcrm-flex imcrm-max-h-60 imcrm-flex-col imcrm-overflow-y-auto imcrm-py-1">
                    {hits.map((hit, i) => (
                        <li key={hit.id}>
                            <button
                                type="button"
                                role="option"
                                aria-selected={i === highlight}
                                onMouseEnter={() => setHighlight(i)}
                                onMouseDown={(e) => {
                                    // mousedown previene blur del textarea
                                    // antes de que onSelect inserte texto.
                                    e.preventDefault();
                                    onSelect(hit);
                                }}
                                className={cn(
                                    'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-text-sm',
                                    i === highlight
                                        ? 'imcrm-bg-accent imcrm-text-foreground'
                                        : 'imcrm-text-foreground hover:imcrm-bg-accent/40',
                                )}
                            >
                                <AtSign className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                                    <span className="imcrm-truncate imcrm-text-sm">
                                        {hit.display_name || hit.login}
                                    </span>
                                    <span className="imcrm-truncate imcrm-text-[10px] imcrm-text-muted-foreground">
                                        @{hit.login}
                                    </span>
                                </div>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

function useDebouncedValue<T>(value: T, delay: number): T {
    const [debounced, setDebounced] = useState(value);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => setDebounced(value), delay);
        return () => {
            if (timeoutRef.current !== null) clearTimeout(timeoutRef.current);
        };
    }, [value, delay]);

    return debounced;
}
