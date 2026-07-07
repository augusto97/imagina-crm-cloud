import { useState } from 'react';
import { GripVertical, Search } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { setDragPayload } from './dragPayload';
import type { BaseTemplateBlock, BlockRegistry, BlockTypeDef } from './types';

type Tab = 'blocks' | 'fields';

interface Props<TBlock extends BaseTemplateBlock> {
    registry: BlockRegistry<TBlock>;
    existingBlocks: TBlock[];
    fields: FieldEntity[];
    onAddBlock: (type: string) => void;
    onAddField: (slug: string) => void;
}

/**
 * Paleta del editor genérico. Soporta tabs Bloques/Campos (el tab
 * Campos solo aparece si el registry define `fieldAsBlock`),
 * búsqueda, drag-from-palette al canvas y click-to-add.
 *
 * Los bloques se agrupan por `category` declarada en cada
 * `BlockTypeDef`. Los singletons se deshabilitan cuando ya existe
 * uno en el canvas.
 */
export function PalettePanel<TBlock extends BaseTemplateBlock>({
    registry,
    existingBlocks,
    fields,
    onAddBlock,
    onAddField,
}: Props<TBlock>): JSX.Element {
    const hasFieldsTab = !! registry.fieldAsBlock;
    const [tab, setTab] = useState<Tab>('blocks');
    const [filter, setFilter] = useState('');

    // Si el registry no tiene fieldsTab y el user llegó a tab='fields'
    // (improbable), volvemos a blocks.
    const effectiveTab: Tab = hasFieldsTab ? tab : 'blocks';

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col">
            <header className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-py-3 imcrm-pl-3 imcrm-pr-12">
                <p className="imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                    {__('Paleta')}
                </p>
                {hasFieldsTab && (
                    <div className="imcrm-flex imcrm-gap-1 imcrm-rounded-md imcrm-bg-muted imcrm-p-0.5">
                        <TabButton active={effectiveTab === 'blocks'} onClick={() => setTab('blocks')}>
                            {__('Bloques')}
                        </TabButton>
                        <TabButton active={effectiveTab === 'fields'} onClick={() => setTab('fields')}>
                            {__('Campos')}
                        </TabButton>
                    </div>
                )}
                <div className="imcrm-relative">
                    <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2 imcrm-top-1/2 imcrm-h-3 imcrm-w-3 imcrm--translate-y-1/2 imcrm-text-muted-foreground" />
                    <input
                        type="text"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder={effectiveTab === 'blocks' ? __('Buscar bloque…') : __('Buscar campo…')}
                        className="imcrm-h-7 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-pl-7 imcrm-pr-2 imcrm-text-xs imcrm-placeholder:text-muted-foreground focus:imcrm-outline-none focus:imcrm-ring-1 focus:imcrm-ring-primary"
                    />
                </div>
                <p className="imcrm-text-[10.5px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Click o arrastrá al canvas.')}
                </p>
            </header>

            <div className="imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-3 imcrm-py-3">
                {effectiveTab === 'blocks' ? (
                    <BlocksTab
                        registry={registry}
                        existingBlocks={existingBlocks}
                        filter={filter}
                        onAdd={onAddBlock}
                    />
                ) : (
                    <FieldsTab
                        registry={registry}
                        fields={fields}
                        filter={filter}
                        onAdd={onAddField}
                    />
                )}
            </div>
        </div>
    );
}

function TabButton({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'imcrm-flex-1 imcrm-rounded imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
                active
                    ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm'
                    : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
            )}
        >
            {children}
        </button>
    );
}

// --- Tab Bloques -------------------------------------------------------------

function BlocksTab<TBlock extends BaseTemplateBlock>({
    registry,
    existingBlocks,
    filter,
    onAdd,
}: {
    registry: BlockRegistry<TBlock>;
    existingBlocks: TBlock[];
    filter: string;
    onAdd: (type: string) => void;
}): JSX.Element {
    const existingTypes = new Set(existingBlocks.map((b) => b.type));
    const needle = filter.trim().toLowerCase();

    const matches = (item: BlockTypeDef): boolean =>
        ! needle
        || item.label.toLowerCase().includes(needle)
        || item.description.toLowerCase().includes(needle);

    const itemsByCategory = new Map<string, BlockTypeDef[]>();
    for (const cat of registry.categories) itemsByCategory.set(cat.id, []);
    for (const t of registry.types) {
        if (! matches(t)) continue;
        if (! itemsByCategory.has(t.category)) itemsByCategory.set(t.category, []);
        itemsByCategory.get(t.category)!.push(t);
    }

    const visibleCats = registry.categories.filter(
        (c) => (itemsByCategory.get(c.id)?.length ?? 0) > 0,
    );

    if (visibleCats.length === 0) {
        return (
            <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-3 imcrm-py-6 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                {__('No hay bloques que coincidan con la búsqueda.')}
            </p>
        );
    }

    return (
        <>
            {visibleCats.map((cat) => (
                <section key={cat.id} className="imcrm-mb-4 last:imcrm-mb-0">
                    <p className="imcrm-mb-2 imcrm-px-1 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                        {cat.label}
                    </p>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        {(itemsByCategory.get(cat.id) ?? []).map((item) => {
                            const disabled = !! item.singleton && existingTypes.has(item.type);
                            return (
                                <BlockPaletteCard
                                    key={item.type}
                                    item={item}
                                    disabled={disabled}
                                    onClick={() => onAdd(item.type)}
                                />
                            );
                        })}
                    </div>
                </section>
            ))}
        </>
    );
}

function BlockPaletteCard({
    item,
    disabled,
    onClick,
}: {
    item: BlockTypeDef;
    disabled: boolean;
    onClick: () => void;
}): JSX.Element {
    const Icon = item.icon;
    return (
        <div
            draggable={! disabled}
            onDragStart={(e) => {
                if (disabled) {
                    e.preventDefault();
                    return;
                }
                setDragPayload(e, { kind: 'block-type', type: item.type });
            }}
            onClick={() => {
                if (! disabled) onClick();
            }}
            role="button"
            tabIndex={disabled ? -1 : 0}
            onKeyDown={(e) => {
                if (disabled) return;
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick();
                }
            }}
            title={disabled ? __('Ya hay uno en el canvas') : item.description}
            className={cn(
                'imcrm-group imcrm-flex imcrm-w-full imcrm-items-start imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-2 imcrm-text-left imcrm-transition-colors',
                ! disabled && 'imcrm-cursor-grab hover:imcrm-border-primary/30 hover:imcrm-bg-accent/50 active:imcrm-cursor-grabbing',
                disabled && 'imcrm-cursor-not-allowed imcrm-opacity-50',
            )}
        >
            <GripVertical
                className={cn(
                    'imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-muted-foreground/50',
                    ! disabled && 'group-hover:imcrm-text-muted-foreground',
                )}
                aria-hidden
            />
            <span
                className={cn(
                    'imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-bg-muted imcrm-text-muted-foreground',
                    ! disabled && 'group-hover:imcrm-bg-primary/10 group-hover:imcrm-text-primary',
                )}
            >
                <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
            </span>
            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-0.5">
                <span className="imcrm-truncate imcrm-text-xs imcrm-font-medium">{item.label}</span>
                <span className="imcrm-line-clamp-2 imcrm-text-[10.5px] imcrm-leading-tight imcrm-text-muted-foreground">
                    {item.description}
                </span>
            </span>
        </div>
    );
}

// --- Tab Campos --------------------------------------------------------------

function FieldsTab<TBlock extends BaseTemplateBlock>({
    registry,
    fields,
    filter,
    onAdd,
}: {
    registry: BlockRegistry<TBlock>;
    fields: FieldEntity[];
    filter: string;
    onAdd: (slug: string) => void;
}): JSX.Element {
    if (! registry.fieldAsBlock) {
        return <></>;
    }
    const adapter = registry.fieldAsBlock;
    const needle = filter.trim().toLowerCase();
    const usable = fields.filter((f) => (adapter.fieldFilter ? adapter.fieldFilter(f) : true));
    const matches = (f: FieldEntity): boolean =>
        ! needle
        || f.label.toLowerCase().includes(needle)
        || f.slug.toLowerCase().includes(needle)
        || f.type.toLowerCase().includes(needle);

    const filtered = usable.filter(matches);

    if (usable.length === 0) {
        return (
            <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-3 imcrm-py-6 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                {__('Esta lista no tiene campos disponibles.')}
            </p>
        );
    }
    if (filtered.length === 0) {
        return (
            <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-3 imcrm-py-6 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                {__('No hay campos que coincidan con la búsqueda.')}
            </p>
        );
    }

    return (
        <>
            <p className="imcrm-mb-2 imcrm-px-1 imcrm-text-[10.5px] imcrm-leading-snug imcrm-text-muted-foreground">
                {__('Soltar al canvas crea un bloque con ese campo.')}
            </p>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                {filtered.map((field) => (
                    <FieldPaletteCard
                        key={field.id}
                        field={field}
                        onClick={() => onAdd(field.slug)}
                    />
                ))}
            </div>
        </>
    );
}

function FieldPaletteCard({
    field,
    onClick,
}: {
    field: FieldEntity;
    onClick: () => void;
}): JSX.Element {
    return (
        <div
            draggable
            onDragStart={(e) => setDragPayload(e, { kind: 'field', slug: field.slug })}
            onClick={onClick}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onClick();
                }
            }}
            title={`${field.label} (${field.type})`}
            className="imcrm-group imcrm-flex imcrm-w-full imcrm-cursor-grab imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-transition-colors hover:imcrm-border-primary/30 hover:imcrm-bg-accent/50 active:imcrm-cursor-grabbing"
        >
            <GripVertical
                className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-muted-foreground/50 group-hover:imcrm-text-muted-foreground"
                aria-hidden
            />
            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                <span className="imcrm-truncate imcrm-text-xs imcrm-font-medium">{field.label}</span>
                <span className="imcrm-truncate imcrm-text-[10px] imcrm-text-muted-foreground">
                    {field.slug} · {field.type}
                </span>
            </span>
        </div>
    );
}
