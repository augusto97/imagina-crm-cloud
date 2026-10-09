import { useState } from 'react';
import { Filter, Info, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import { countConditions, isEmptyTree, type FilterTree } from '@/types/record';

import { FilterGroupView } from './FilterGroupView';
import { SavedFiltersDropdown } from './SavedFiltersDropdown';

interface FiltersPanelProps {
    listId: number | undefined;
    fields: FieldEntity[];
    tree: FilterTree;
    onChange: (next: FilterTree) => void;
    /**
     * Si `true`, renderiza el árbol de filtros incrustado en el flujo
     * normal (sin botón trigger ni popover). Útil dentro de diálogos
     * angostos como `WidgetFormDialog`, donde el popover de 720px se
     * desbordaba del viewport (ClickUp lo resuelve igual: panel
     * inline en el form lateral del widget).
     */
    inline?: boolean;
}

/**
 * Panel inline ClickUp-style.
 *
 * Por defecto se renderiza vía Radix `Popover` (collision detection
 * + auto-flip) para que el panel quede dentro del viewport en la
 * vista de Records. Cuando se usa dentro de un diálogo angosto (ver
 * `inline`), se incrusta directo en el form sin trigger.
 */
export function FiltersPanel({
    listId,
    fields,
    tree,
    onChange,
    inline = false,
}: FiltersPanelProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const count = isEmptyTree(tree) ? 0 : countConditions(tree);

    if (inline) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-text-foreground">
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3">
                    <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-semibold imcrm-text-foreground">
                        <Filter className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                        {__('Filtros')}
                        <span
                            className="imcrm-cursor-help imcrm-text-muted-foreground"
                            title={__(
                                'Combina filtros con Y / O. Usa "Agregar filtro anidado" para grupos.',
                            )}
                        >
                            <Info className="imcrm-h-3 imcrm-w-3" />
                        </span>
                    </h3>
                    {listId !== undefined && (
                        <SavedFiltersDropdown
                            listId={listId}
                            currentTree={tree}
                            onApply={onChange}
                        />
                    )}
                </div>

                <FilterGroupView
                    root={tree}
                    path={[]}
                    fields={fields}
                    listId={listId}
                    onRootChange={onChange}
                />

                {!isEmptyTree(tree) && (
                    <div className="imcrm-flex imcrm-justify-end imcrm-border-t imcrm-border-border imcrm-pt-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                                onChange({ type: 'group', logic: 'and', children: [] })
                            }
                            className="imcrm-text-destructive hover:imcrm-bg-destructive/10"
                        >
                            {__('Borrar todo')}
                        </Button>
                    </div>
                )}
            </div>
        );
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="outline"
                    size="sm"
                    className={cn(
                        'imcrm-gap-1.5',
                        count > 0 &&
                            'imcrm-border-primary/40 imcrm-bg-primary/10 imcrm-text-primary',
                    )}
                >
                    <Filter className="imcrm-h-3.5 imcrm-w-3.5" />
                    {count === 0
                        ? __('Filtrar')
                        : sprintf(
                            /* translators: %d count of active filter conditions */
                            count === 1 ? __('%d filtro') : __('%d filtros'),
                            count,
                        )}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                sideOffset={8}
                collisionPadding={16}
                className="imcrm-w-[min(720px,calc(100vw-2rem))] imcrm-p-4 imcrm-text-foreground"
                onOpenAutoFocus={(e) => e.preventDefault()}
            >
                <div className="imcrm-mb-3 imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3">
                    <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-semibold imcrm-text-foreground">
                        <Filter className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                        {__('Filtros')}
                        <span
                            className="imcrm-cursor-help imcrm-text-muted-foreground"
                            title={__(
                                'Combina filtros con Y / O. Usa "Agregar filtro anidado" para grupos.',
                            )}
                        >
                            <Info className="imcrm-h-3 imcrm-w-3" />
                        </span>
                    </h3>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                        {listId !== undefined && (
                            <SavedFiltersDropdown
                                listId={listId}
                                currentTree={tree}
                                onApply={onChange}
                            />
                        )}
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-text-foreground"
                            aria-label={__('Cerrar panel')}
                        >
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </button>
                    </div>
                </div>

                <FilterGroupView
                    root={tree}
                    path={[]}
                    fields={fields}
                    listId={listId}
                    onRootChange={onChange}
                />

                {!isEmptyTree(tree) && (
                    <div className="imcrm-mt-3 imcrm-flex imcrm-justify-end imcrm-border-t imcrm-border-border imcrm-pt-3">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                                onChange({ type: 'group', logic: 'and', children: [] })
                            }
                            className="imcrm-text-destructive hover:imcrm-bg-destructive/10"
                        >
                            {__('Borrar todo')}
                        </Button>
                    </div>
                )}
            </PopoverContent>
        </Popover>
    );
}
