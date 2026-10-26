import { useEffect, useState } from 'react';
import { Loader2, UserPlus, X } from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useWpUser, useWpUsersSearch } from '@/hooks/useWpUsers';
import { getBootData } from '@/lib/boot';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { HOVER_REVEAL } from './checklistModel';

interface ChecklistAssigneeProps {
    value: number | null;
    onChange: (id: number | null) => void;
    disabled?: boolean;
}

/**
 * A9 — Responsable de un ítem de checklist: un avatar chico (o el icono de
 * asignar, que aparece al pasar el mouse) que abre un buscador de miembros.
 * Más compacto que el `UserPicker` de los campos: va en cada fila.
 */
export function ChecklistAssignee({ value, onChange, disabled = false }: ChecklistAssigneeProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const debounced = useDebouncedValue(query, 200);
    const user = useWpUser(value);
    const search = useWpUsersSearch(open ? debounced : '', 8);
    const meId = getBootData().user.id || null;
    useEffect(() => {
        if (!open) setQuery('');
    }, [open]);

    const name = user.data ? user.data.display_name || user.data.login : value ? sprintf(__('Usuario #%d'), value) : '';
    const pick = (id: number | null): void => {
        onChange(id);
        setOpen(false);
    };

    return (
        <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={disabled}
                    title={value ? sprintf(__('Responsable: %s'), name) : __('Asignar responsable')}
                    aria-label={value ? sprintf(__('Responsable: %s'), name) : __('Asignar responsable')}
                    className={cn(
                        'imcrm-inline-flex imcrm-h-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md',
                        value ? '' : 'imcrm-w-6 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground',
                        !value && HOVER_REVEAL,
                        disabled && 'imcrm-cursor-default',
                    )}
                    data-testid="imcrm-checklist-assignee"
                >
                    {value ? <Avatar name={name || '?'} size="sm" className="imcrm-h-5 imcrm-w-5 imcrm-text-[9px]" /> : <UserPlus className="imcrm-h-3.5 imcrm-w-3.5" />}
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={4} className="imcrm-w-64 imcrm-p-0" onClick={(e) => e.stopPropagation()}>
                <div className="imcrm-border-b imcrm-border-border imcrm-p-2">
                    <Input
                        autoFocus
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                const first = search.data?.[0];
                                if (first) pick(first.id);
                            }
                        }}
                        placeholder={__('Buscar persona…')}
                        className="imcrm-h-8 imcrm-text-sm"
                    />
                </div>
                <ul className="imcrm-max-h-56 imcrm-overflow-y-auto imcrm-py-1">
                    {meId !== null && meId !== value && (
                        <li>
                            <button
                                type="button"
                                onClick={() => pick(meId)}
                                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent"
                            >
                                <UserPlus className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" />
                                {__('Asignármelo')}
                            </button>
                        </li>
                    )}
                    {search.isFetching && debounced !== '' ? (
                        <li className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                            {__('Buscando…')}
                        </li>
                    ) : debounced === '' ? (
                        <li className="imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">{__('Escribe un nombre para buscar.')}</li>
                    ) : (search.data ?? []).length === 0 ? (
                        <li className="imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">{__('Sin resultados.')}</li>
                    ) : (
                        (search.data ?? []).map((u) => (
                            <li key={u.id}>
                                <button
                                    type="button"
                                    onClick={() => pick(u.id)}
                                    className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent"
                                >
                                    <Avatar name={u.display_name || u.login} size="sm" />
                                    <span className="imcrm-truncate">{u.display_name || u.login}</span>
                                </button>
                            </li>
                        ))
                    )}
                </ul>
                {value !== null && (
                    <div className="imcrm-border-t imcrm-border-border imcrm-px-2 imcrm-py-1.5">
                        <button
                            type="button"
                            onClick={() => pick(null)}
                            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-destructive"
                        >
                            <X className="imcrm-h-3 imcrm-w-3" />
                            {__('Quitar responsable')}
                        </button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}
