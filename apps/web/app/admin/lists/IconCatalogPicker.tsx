import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';

import {
    LIST_ICONS,
    LIST_ICON_CATEGORIES,
    LIST_ICON_COLORS,
    listColor,
    searchListIcons,
} from '@/lib/listIcons';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface IconCatalogPickerProps {
    icon: string | null;
    color: string | null;
    onChange: (next: { icon: string | null; color: string | null }) => void;
    /** Alto máximo de la grilla (scrollea adentro). */
    gridMaxHeight?: number;
}

/**
 * Selector de icono + color compartido (v0.1.175): la fila de colores, un
 * buscador (sin acentos) y la grilla del catálogo AGRUPADA por categoría —
 * 324 glifos sólidos, como el selector de ClickUp. Lo montan el popover de
 * Ajustes (`ListIconPicker`) y el submenú "Color e ícono" del panel.
 */
export function IconCatalogPicker({ icon, color, onChange, gridMaxHeight = 260 }: IconCatalogPickerProps): JSX.Element {
    const [query, setQuery] = useState('');
    const hex = listColor(color);

    const visible = useMemo(() => searchListIcons(query), [query]);
    const searching = query.trim() !== '';
    const groups = useMemo(
        () =>
            searching
                ? [{ category: null, items: visible }]
                : LIST_ICON_CATEGORIES.map((category) => ({
                      category,
                      items: LIST_ICONS.filter((e) => e.category === category),
                  })),
        [searching, visible],
    );

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <p className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">{__('Color')}</p>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                    {LIST_ICON_COLORS.map((c) => (
                        <button
                            key={c.hex}
                            type="button"
                            title={c.label}
                            aria-label={c.label}
                            aria-pressed={hex === c.hex}
                            onClick={() => onChange({ icon: icon ?? 'list', color: c.hex })}
                            className={cn(
                                'imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-ring-1 imcrm-ring-border',
                                hex === c.hex && 'imcrm-ring-2 imcrm-ring-primary',
                            )}
                            style={{ backgroundColor: c.hex }}
                        >
                            {hex === c.hex && <Check className="imcrm-h-3 imcrm-w-3 imcrm-text-white" aria-hidden />}
                        </button>
                    ))}
                </div>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                    <p className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">{__('Icono')}</p>
                    {icon !== null && (
                        <button
                            type="button"
                            onClick={() => onChange({ icon: null, color: null })}
                            className="imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline"
                        >
                            {__('Quitar el icono')}
                        </button>
                    )}
                </div>
                <label className="imcrm-relative imcrm-block">
                    <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2 imcrm-top-1/2 imcrm-h-3.5 imcrm-w-3.5 -imcrm-translate-y-1/2 imcrm-text-muted-foreground" aria-hidden />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={__('Buscar…')}
                        aria-label={__('Buscar icono')}
                        data-testid="icon-search"
                        // El submenú de Radix captura el teclado para navegar
                        // por ítems: el input tiene que quedarse las teclas.
                        onKeyDown={(e) => e.stopPropagation()}
                        className="imcrm-h-8 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-pl-7 imcrm-pr-2 imcrm-text-[13px] imcrm-outline-none focus:imcrm-ring-2 focus:imcrm-ring-primary/30"
                    />
                </label>
                <div
                    className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-overflow-y-auto imcrm-pr-1"
                    style={{ maxHeight: gridMaxHeight }}
                    data-testid="icon-grid"
                >
                    {groups.map((g) =>
                        g.items.length === 0 ? null : (
                            <div key={g.category ?? '__search'} className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                {g.category !== null && (
                                    <p className="imcrm-sticky imcrm-top-0 imcrm-bg-popover imcrm-py-0.5 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                        {g.category}
                                    </p>
                                )}
                                <div className="imcrm-grid imcrm-grid-cols-8 imcrm-gap-0.5">
                                    {g.items.map(({ key, icon: Icon, label }) => (
                                        <button
                                            key={key}
                                            type="button"
                                            title={label}
                                            aria-label={label}
                                            aria-pressed={icon === key}
                                            onClick={() => onChange({ icon: key, color })}
                                            className={cn(
                                                'imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground',
                                                icon === key && 'imcrm-bg-primary/10 imcrm-text-primary imcrm-ring-1 imcrm-ring-primary/40',
                                            )}
                                        >
                                            <Icon className="imcrm-h-[18px] imcrm-w-[18px]" />
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ),
                    )}
                    {searching && visible.length === 0 && (
                        <p className="imcrm-py-4 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Ningún icono coincide.')}
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
