import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Loader2, Plus, Search, X } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useFields } from '@/hooks/useFields';
import { relationIds, relationTarget, useRelationTitles, type RelationTitles } from '@/hooks/useRelationTitles';
import { api } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { titleFieldOf } from '@/lib/recordTitle';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

interface RelationPickerProps {
    field: FieldEntity;
    value: unknown;
    onChange: (ids: number[]) => void;
    disabled?: boolean;
    /** `cell`: trigger plano para la tabla (sin caja ni ×, como el OptionPicker). */
    variant?: 'default' | 'cell';
    /** Títulos ya resueltos por la tabla (una query por columna, no por celda). */
    knownTitles?: RelationTitles;
    wrap?: boolean;
    id?: string;
}

/** Chip de un registro vinculado. */
export function RelationChip({ label, onRemove }: { label: string; onRemove?: () => void }): JSX.Element {
    return (
        <span className="imcrm-inline-flex imcrm-min-w-0 imcrm-max-w-full imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-muted/60 imcrm-px-1.5 imcrm-py-px imcrm-text-xs imcrm-font-medium">
            <span className="imcrm-truncate">{label}</span>
            {onRemove && (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onRemove();
                    }}
                    aria-label={`${__('Quitar')} ${label}`}
                    className="imcrm-shrink-0 imcrm-rounded imcrm-text-muted-foreground hover:imcrm-text-foreground"
                >
                    <X className="imcrm-h-3 imcrm-w-3" />
                </button>
            )}
        </span>
    );
}

/**
 * Selector de registros para un campo relation (v0.1.209): chips con el
 * TÍTULO de cada vinculado y un buscador sobre la lista destino (búsqueda del
 * servidor, así respeta el ACL: nadie vincula lo que no puede ver). Antes la
 * relación se editaba tipeando ids separados por coma.
 */
export function RelationPicker({
    field,
    value,
    onChange,
    disabled,
    variant = 'default',
    knownTitles,
    wrap = false,
    id,
}: RelationPickerProps): JSX.Element {
    const target = relationTarget(field);
    const ids = relationIds(value);
    const missing = knownTitles ? ids.filter((i) => knownTitles[i] === undefined) : ids;
    const titles = useRelationTitles(target, missing);
    const label = (i: number): string => {
        const t = knownTitles?.[i] ?? titles.data?.[i];
        return t && t !== '' ? t : `#${i}`;
    };
    const [open, setOpen] = useState(false);

    if (target === null) {
        return <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Elegí la lista vinculada en la configuración del campo.')}</span>;
    }

    const toggle = (rid: number): void => {
        onChange(ids.includes(rid) ? ids.filter((x) => x !== rid) : [...ids, rid]);
    };

    const chips = ids.map((i) => (
        <RelationChip key={i} label={label(i)} onRemove={variant === 'default' && !disabled ? () => toggle(i) : undefined} />
    ));

    return (
        <Popover open={open} onOpenChange={(o) => !disabled && setOpen(o)}>
            <PopoverTrigger asChild disabled={disabled}>
                {variant === 'cell' ? (
                    <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className={cn(
                            'imcrm-flex imcrm-min-h-[1.5rem] imcrm-w-full imcrm-min-w-0 imcrm-items-center imcrm-gap-1 imcrm-text-left',
                            wrap ? 'imcrm-flex-wrap' : 'imcrm-overflow-hidden',
                        )}
                        data-testid={`imcrm-relation-cell-${field.slug}`}
                    >
                        {ids.length === 0 ? <span className="imcrm-text-muted-foreground/50">—</span> : chips}
                    </button>
                ) : (
                    <div
                        id={id}
                        role="button"
                        tabIndex={disabled ? -1 : 0}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                setOpen(true);
                            }
                        }}
                        className={cn(
                            'imcrm-flex imcrm-min-h-8 imcrm-w-full imcrm-flex-wrap imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-py-1 imcrm-text-sm',
                            disabled ? 'imcrm-opacity-60' : 'imcrm-cursor-pointer hover:imcrm-bg-accent/40',
                        )}
                        data-testid={`imcrm-relation-picker-${field.slug}`}
                    >
                        {chips}
                        {!disabled && (
                            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground">
                                <Plus className="imcrm-h-3 imcrm-w-3" />
                                {ids.length === 0 ? __('Vincular') : ''}
                            </span>
                        )}
                    </div>
                )}
            </PopoverTrigger>
            <PopoverContent align="start" className="imcrm-w-80 imcrm-p-0" onClick={(e) => e.stopPropagation()}>
                {open && <RelationSearch target={target} selected={ids} onToggle={toggle} />}
            </PopoverContent>
        </Popover>
    );
}

function RelationSearch({
    target,
    selected,
    onToggle,
}: {
    target: number;
    selected: number[];
    onToggle: (id: number) => void;
}): JSX.Element {
    const [q, setQ] = useState('');
    const debounced = useDebouncedValue(q.trim(), 250);
    const fields = useFields(target);
    const title = titleFieldOf(fields.data);
    const results = useQuery({
        queryKey: ['relation-search', String(target), debounced] as const,
        queryFn: async () =>
            (
                await api.get<RecordEntity[]>(`/lists/${target}/records`, {
                    query: { per_page: 20, ...(debounced ? { search: debounced } : {}) },
                })
            ).data,
        staleTime: 10_000,
    });
    const name = (r: RecordEntity): string => {
        const v = title ? r.fields[title.slug] : null;
        return typeof v === 'string' && v !== '' ? v : typeof v === 'number' ? String(v) : `#${r.id}`;
    };
    return (
        <div className="imcrm-flex imcrm-flex-col">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-2.5 imcrm-py-2">
                <Search className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                <input
                    autoFocus
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => e.stopPropagation()}
                    placeholder={__('Buscar…')}
                    className="imcrm-w-full imcrm-bg-transparent imcrm-text-sm imcrm-outline-none"
                    data-testid="imcrm-relation-search"
                />
                {results.isFetching && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin imcrm-text-muted-foreground" />}
            </div>
            <ul className="imcrm-max-h-64 imcrm-overflow-y-auto imcrm-py-1" role="listbox">
                {(results.data ?? []).map((r) => {
                    const on = selected.includes(r.id);
                    return (
                        <li key={r.id}>
                            <button
                                type="button"
                                role="option"
                                aria-selected={on}
                                onClick={() => onToggle(r.id)}
                                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-2.5 imcrm-py-1.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent"
                                data-testid={`imcrm-relation-option-${r.id}`}
                            >
                                <span className="imcrm-flex imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-items-center imcrm-justify-center">
                                    {on && <Check className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" />}
                                </span>
                                <span className="imcrm-truncate">{name(r)}</span>
                            </button>
                        </li>
                    );
                })}
                {results.data && results.data.length === 0 && (
                    <li className="imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">{__('Sin resultados.')}</li>
                )}
            </ul>
        </div>
    );
}
