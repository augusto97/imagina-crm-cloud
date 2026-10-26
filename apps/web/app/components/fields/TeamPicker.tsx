import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Users, X } from 'lucide-react';
import type { Team } from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useTeamMap, useTeams } from '@/hooks/useTeams';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { TeamChips, TeamGlyph } from './TeamChip';

interface TeamPickerProps {
    /** Ids elegidos (el campo «Equipo» siempre guarda una lista). */
    value: number[];
    onChange: (ids: number[]) => void;
    /** Varios equipos (si no, elegir uno reemplaza al anterior y cierra). */
    multiple: boolean;
    disabled?: boolean;
    /** `cell`: sin caja, como el resto de los selectores de la tabla. */
    variant?: 'default' | 'cell' | 'flat';
    compact?: boolean;
    wrap?: boolean;
    placeholder?: string;
    /** Arrancar abierto (la celda lo monta recién en el primer click). */
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** Lo que se tecleó en la celda para abrirlo: va al buscador. */
    initialQuery?: string;
}

function fold(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * C1 — Selector del campo «Equipo»: buscador, una casilla por equipo (con
 * su icono, color y cuántas personas tiene) y «Quitar». En modo múltiple el
 * popover queda abierto para marcar varios, como el de selección múltiple.
 */
export function TeamPicker({
    value,
    onChange,
    multiple,
    disabled,
    variant = 'default',
    compact,
    wrap,
    placeholder,
    defaultOpen = false,
    onOpenChange,
    initialQuery = '',
}: TeamPickerProps): JSX.Element {
    const [open, setOpen] = useState(defaultOpen);
    const [query, setQuery] = useState(initialQuery);
    const [highlight, setHighlight] = useState(0);
    const lastOpen = useRef(open);
    const teams = useTeams();
    const map = useTeamMap();

    useEffect(() => {
        if (lastOpen.current === open) return;
        lastOpen.current = open;
        onOpenChange?.(open);
        if (!open) {
            setQuery('');
            setHighlight(0);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const hits = useMemo(() => {
        const q = fold(query.trim());
        const all = teams.data ?? [];
        return q === '' ? all : all.filter((t) => fold(t.name).includes(q) || fold(t.description ?? '').includes(q));
    }, [teams.data, query]);

    const toggle = (team: Team): void => {
        if (multiple) {
            onChange(value.includes(team.id) ? value.filter((id) => id !== team.id) : [...value, team.id]);
            return;
        }
        // Elegir el que ya está lo quita (como el selector de opciones).
        onChange(value.includes(team.id) ? [] : [team.id]);
        setOpen(false);
    };

    const flatTrigger = variant === 'cell' || variant === 'flat';
    const empty = value.length === 0;

    return (
        <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    disabled={disabled}
                    data-testid="imcrm-team-picker"
                    className={cn(
                        flatTrigger
                            ? 'imcrm-inline-flex imcrm-min-h-[1.5rem] imcrm-w-full imcrm-min-w-0 imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent/40'
                            : cn(
                                  'imcrm-inline-flex imcrm-w-full imcrm-min-w-0 imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-text-left imcrm-text-sm imcrm-transition-colors',
                                  compact ? 'imcrm-min-h-8 imcrm-px-2 imcrm-py-1' : 'imcrm-min-h-9 imcrm-px-3 imcrm-py-1',
                                  !disabled && 'hover:imcrm-border-primary/40',
                              ),
                        variant === 'flat' && 'imcrm--mx-1 imcrm-px-1',
                        disabled && 'imcrm-cursor-not-allowed imcrm-opacity-60',
                    )}
                >
                    {empty ? (
                        variant === 'cell' ? (
                            <span className="imcrm-text-muted-foreground/50">—</span>
                        ) : (
                            <span className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-gap-1.5 imcrm-text-muted-foreground">
                                <Users className="imcrm-h-3.5 imcrm-w-3.5" />
                                {placeholder ?? (multiple ? __('Elegir equipos…') : __('Elegir equipo…'))}
                            </span>
                        )
                    ) : (
                        <TeamChips ids={value} teams={map} wrap={wrap ?? !flatTrigger} className="imcrm-flex-1" />
                    )}
                    {!flatTrigger && <ChevronDown className="imcrm-ml-auto imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />}
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                sideOffset={4}
                className="imcrm-w-72 imcrm-p-0"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="imcrm-border-b imcrm-border-border imcrm-p-2">
                    <Input
                        autoFocus
                        value={query}
                        placeholder={__('Buscar equipo…')}
                        aria-label={__('Buscar equipo')}
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
                                const t = hits[highlight] ?? hits[0];
                                if (t) toggle(t);
                            } else if (e.key === 'Escape') {
                                e.preventDefault();
                                setOpen(false);
                            }
                        }}
                    />
                </div>
                <ul role="listbox" aria-multiselectable={multiple} className="imcrm-max-h-64 imcrm-overflow-y-auto imcrm-p-1">
                    {teams.isLoading && (
                        <li className="imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-text-muted-foreground">{__('Cargando…')}</li>
                    )}
                    {!teams.isLoading && hits.length === 0 && (
                        <li className="imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                            {(teams.data ?? []).length === 0
                                ? __('Todavía no hay equipos. Créalos en Ajustes → Equipos.')
                                : __('Ningún equipo coincide.')}
                        </li>
                    )}
                    {hits.map((t, i) => {
                        const selected = value.includes(t.id);
                        return (
                            <li key={t.id} role="option" aria-selected={selected}>
                                <button
                                    type="button"
                                    onMouseEnter={() => setHighlight(i)}
                                    onClick={() => toggle(t)}
                                    className={cn(
                                        'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm',
                                        i === highlight && 'imcrm-bg-accent',
                                    )}
                                >
                                    <TeamGlyph team={t} size="sm" />
                                    <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{t.name}</span>
                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{t.member_count}</span>
                                    <Check className={cn('imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary', !selected && 'imcrm-invisible')} />
                                </button>
                            </li>
                        );
                    })}
                </ul>
                {!empty && (
                    <div className="imcrm-border-t imcrm-border-border imcrm-p-1">
                        <button
                            type="button"
                            onClick={() => {
                                onChange([]);
                                setOpen(false);
                            }}
                            className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-bg-accent"
                        >
                            <X className="imcrm-h-3.5 imcrm-w-3.5" />
                            {multiple ? __('Quitar todos') : __('Quitar el equipo')}
                        </button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}
