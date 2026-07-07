import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, Database, Loader2, Search } from 'lucide-react';

import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useRecords } from '@/hooks/useRecords';
import { pickPrimaryField } from '@/lib/recordCategorize';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

interface RecordSelectorProps {
    listId: number;
    fields: FieldEntity[];
    value: RecordEntity | null;
    onChange: (record: RecordEntity | null) => void;
    className?: string;
}

const DEBOUNCE_MS = 250;

/**
 * Selector de record para usar como dato real en el preview del
 * editor de plantilla CRM (Fase 11.E).
 *
 * Click abre un popover con input de búsqueda y lista de los
 * primeros records de la lista (o filtrados por la búsqueda). Los
 * labels usan el primary field del record.
 *
 * Opción especial "Datos de muestra" deselecciona el record y
 * vuelve al mock generado a partir del schema de fields.
 */
export function RecordSelector({
    listId,
    fields,
    value,
    onChange,
    className,
}: RecordSelectorProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const [searchInput, setSearchInput] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const triggerRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        const t = window.setTimeout(() => setDebouncedSearch(searchInput), DEBOUNCE_MS);
        return () => window.clearTimeout(t);
    }, [searchInput]);

    const records = useRecords(listId, {
        page: 1,
        per_page: 20,
        ...(debouncedSearch ? { search: debouncedSearch } : {}),
    });

    const primary = useMemo(() => pickPrimaryField(fields), [fields]);

    const labelOf = (rec: RecordEntity): string => {
        if (! primary) return `#${rec.id}`;
        const raw = rec.fields[primary.slug];
        if (raw == null || raw === '') return `#${rec.id}`;
        return String(raw);
    };

    const triggerLabel = value ? labelOf(value) : __('Datos de muestra');

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverAnchor asChild>
                <button
                    ref={triggerRef}
                    type="button"
                    onClick={() => setOpen((v) => ! v)}
                    className={cn(
                        'imcrm-flex imcrm-h-8 imcrm-min-w-[180px] imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2.5 imcrm-text-xs imcrm-transition-colors hover:imcrm-border-primary/40',
                        className,
                    )}
                    aria-haspopup="listbox"
                    aria-expanded={open}
                >
                    <Database className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-muted-foreground" />
                    <span className="imcrm-flex-1 imcrm-truncate imcrm-text-left">
                        {triggerLabel}
                    </span>
                    <ChevronsUpDown className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-muted-foreground" />
                </button>
            </PopoverAnchor>
            <PopoverContent
                align="end"
                className="imcrm-z-50 imcrm-flex imcrm-w-[280px] imcrm-flex-col imcrm-gap-0 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-0 imcrm-shadow-imcrm-lg"
            >
                <div className="imcrm-relative imcrm-border-b imcrm-border-border imcrm-p-2">
                    <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-3.5 imcrm-top-1/2 imcrm-h-3 imcrm-w-3 imcrm--translate-y-1/2 imcrm-text-muted-foreground" />
                    <input
                        type="text"
                        autoFocus
                        value={searchInput}
                        onChange={(e) => setSearchInput(e.target.value)}
                        placeholder={__('Buscar record…')}
                        className="imcrm-h-7 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-pl-7 imcrm-pr-2 imcrm-text-xs imcrm-placeholder:text-muted-foreground focus:imcrm-outline-none focus:imcrm-ring-1 focus:imcrm-ring-primary"
                    />
                </div>

                <div className="imcrm-flex imcrm-max-h-[280px] imcrm-flex-col imcrm-overflow-y-auto imcrm-py-1">
                    <button
                        type="button"
                        onClick={() => {
                            onChange(null);
                            setOpen(false);
                        }}
                        className={cn(
                            'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-text-xs imcrm-transition-colors hover:imcrm-bg-accent',
                            ! value && 'imcrm-bg-accent/50',
                        )}
                    >
                        <Check className={cn('imcrm-h-3 imcrm-w-3', ! value ? 'imcrm-text-primary' : 'imcrm-text-transparent')} />
                        <span className="imcrm-flex imcrm-flex-col">
                            <span className="imcrm-font-medium">{__('Datos de muestra')}</span>
                            <span className="imcrm-text-[10px] imcrm-text-muted-foreground">
                                {__('Mock generado desde el schema de campos.')}
                            </span>
                        </span>
                    </button>

                    {records.isLoading && (
                        <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
                            {__('Cargando…')}
                        </p>
                    )}
                    {! records.isLoading && records.data?.data.length === 0 && (
                        <p className="imcrm-px-3 imcrm-py-3 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                            {debouncedSearch
                                ? __('Sin resultados para la búsqueda.')
                                : __('Esta lista no tiene records todavía.')}
                        </p>
                    )}
                    {records.data?.data.map((rec) => {
                        const isSelected = value?.id === rec.id;
                        return (
                            <button
                                key={rec.id}
                                type="button"
                                onClick={() => {
                                    onChange(rec);
                                    setOpen(false);
                                }}
                                className={cn(
                                    'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-3 imcrm-py-1.5 imcrm-text-left imcrm-text-xs imcrm-transition-colors hover:imcrm-bg-accent',
                                    isSelected && 'imcrm-bg-accent/50',
                                )}
                            >
                                <Check
                                    className={cn(
                                        'imcrm-h-3 imcrm-w-3',
                                        isSelected ? 'imcrm-text-primary' : 'imcrm-text-transparent',
                                    )}
                                />
                                <span className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-overflow-hidden">
                                    <span className="imcrm-truncate imcrm-font-medium">
                                        {labelOf(rec)}
                                    </span>
                                    <span className="imcrm-text-[10px] imcrm-text-muted-foreground">
                                        #{rec.id}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </PopoverContent>
        </Popover>
    );
}
