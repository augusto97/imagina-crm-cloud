import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AtSign } from 'lucide-react';

import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { api } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export interface MentionableUser {
    id: number;
    login: string;
    display_name: string;
}

interface UserMentionMenuProps {
    /** Texto tipeado después del `@` (puede ser vacío). */
    query: string;
    top: number;
    left: number;
    onPick: (user: MentionableUser) => void;
    onClose: () => void;
}

/**
 * Buscador de personas del editor de descripción (v0.1.134).
 *
 * Sólo devuelve MIEMBROS del workspace (el endpoint ya lo acota), y el
 * backend vuelve a validarlo al guardar: mencionar a alguien ajeno no
 * notifica a nadie.
 */
export function UserMentionMenu({
    query,
    top,
    left,
    onPick,
    onClose,
}: UserMentionMenuProps): JSX.Element | null {
    const debounced = useDebouncedValue(query, 150);
    const [index, setIndex] = useState(0);

    const search = useQuery({
        queryKey: ['users-search', debounced],
        queryFn: async () => {
            const res = await api.get<MentionableUser[]>('/me/users-search', {
                query: { q: debounced, limit: 8 },
            });
            return res.data;
        },
        staleTime: 30_000,
    });
    // useMemo: `hits` es dependencia del efecto de teclado — sin identidad
    // estable, el listener se re-registraría en cada render.
    const hits = useMemo(() => search.data ?? [], [search.data]);

    useEffect(() => {
        setIndex(0);
    }, [debounced]);

    // El teclado se maneja acá (el editor no sabe de esta lista).
    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            if (hits.length === 0) return;
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const dir = e.key === 'ArrowDown' ? 1 : -1;
                setIndex((i) => (i + dir + hits.length) % hits.length);
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                const user = hits[index];
                if (user !== undefined) {
                    e.preventDefault();
                    onPick(user);
                }
            } else if (e.key === 'Escape') {
                onClose();
            }
        };
        document.addEventListener('keydown', onKey, true);
        return () => document.removeEventListener('keydown', onKey, true);
    }, [hits, index, onPick, onClose]);

    if (hits.length === 0) return null;

    return (
        <div
            role="listbox"
            aria-label={__('Mencionar persona')}
            className="imcrm-absolute imcrm-z-50 imcrm-max-h-64 imcrm-w-64 imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-1 imcrm-shadow-imcrm-lg"
            style={{ top, left }}
        >
            {hits.map((user, i) => (
                <button
                    key={user.id}
                    type="button"
                    role="option"
                    aria-selected={i === index}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        onPick(user);
                    }}
                    onMouseEnter={() => setIndex(i)}
                    className={cn(
                        'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-left',
                        i === index ? 'imcrm-bg-accent' : 'hover:imcrm-bg-accent/60',
                    )}
                >
                    <span className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-muted-foreground">
                        <AtSign className="imcrm-h-3 imcrm-w-3" aria-hidden />
                    </span>
                    <span className="imcrm-min-w-0">
                        <span className="imcrm-block imcrm-truncate imcrm-text-[13px] imcrm-font-medium">
                            {user.display_name}
                        </span>
                        <span className="imcrm-block imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                            {user.login}
                        </span>
                    </span>
                </button>
            ))}
        </div>
    );
}
