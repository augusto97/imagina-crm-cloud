import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Columns3, Copy, GripVertical, Plus, Trash2 } from 'lucide-react';
import type { LayoutBlock, LayoutSection } from '@imagina-base/shared';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { LayoutBlockView } from '../LayoutBlocks';
import { useLayoutCtx } from '../LayoutContext';
import { LayoutBody, SectionTitle, sectionStyle } from '../RecordLayoutView';
import { BLOCK_CATALOG, CATEGORY_LABEL, blockIcon, blockLabel, type CatalogCategory } from './blockCatalog';
import { isLayoutDrag, readDrag, useEditor, writeDrag } from './editorState';
import {
    COLUMN_PRESETS,
    duplicateBlock,
    duplicateSection,
    findBlock,
    insertSection,
    moveBlock,
    moveSection,
    removeBlock,
    removeSection,
    setSectionColumns,
} from './layoutOps';

/**
 * v0.1.231 — El lienzo del editor: la ficha REAL (los mismos componentes que
 * ve la persona, con datos de un registro de verdad) con los controles del
 * editor alrededor. Lo que se ve aquí es lo que se ve en la ficha.
 */
export function EditorCanvas({ onPageChange }: { onPageChange: (id: string) => void }): JSX.Element {
    const ed = useEditor();
    return (
        <div
            className="imcrm-lay-root imcrm-flex imcrm-flex-col imcrm-gap-4"
            onClick={(e) => {
                if (e.target === e.currentTarget) ed.select({ kind: 'page' });
            }}
        >
            <LayoutBody
                layout={ed.layout}
                pageId={ed.pageId}
                onPageChange={onPageChange}
                renderHeader={(header) => <HeaderChrome>{header}</HeaderChrome>}
                renderSection={(section, gap) => <SectionChrome section={section} gap={gap} />}
                footer={<AddSectionBar />}
            />
        </div>
    );
}

function HeaderChrome({ children }: { children: ReactNode }): JSX.Element {
    const ed = useEditor();
    const selected = ed.selection?.kind === 'header';
    return (
        <div
            className={cn(
                'imcrm-group/h imcrm-relative imcrm-rounded-[14px] imcrm-outline imcrm-outline-2 imcrm-outline-offset-2 imcrm-transition-[outline-color]',
                selected ? 'imcrm-outline-primary' : 'imcrm-outline-transparent hover:imcrm-outline-primary/40',
            )}
            data-testid="editor-header"
        >
            {children ?? (
                // Cabecera oculta: queda un asa para volver a mostrarla.
                <div className="imcrm-flex imcrm-items-center imcrm-justify-center imcrm-rounded-[14px] imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Cabecera oculta — elígela para mostrarla')}
                </div>
            )}
            <button
                type="button"
                className="imcrm-absolute imcrm-inset-0 imcrm-z-10 imcrm-cursor-pointer imcrm-rounded-[14px]"
                onClick={() => ed.select({ kind: 'header' })}
                aria-label={__('Editar la cabecera')}
            />
            <Tag className={cn(!selected && 'imcrm-opacity-0 group-hover/h:imcrm-opacity-100')}>{__('Cabecera')}</Tag>
        </div>
    );
}

function Tag({ children, className }: { children: ReactNode; className?: string }): JSX.Element {
    return (
        <span className={cn('imcrm-pointer-events-none imcrm-absolute imcrm--top-3 imcrm-left-3 imcrm-z-20 imcrm-rounded-md imcrm-bg-primary imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-semibold imcrm-text-primary-foreground imcrm-transition-opacity', className)}>
            {children}
        </span>
    );
}

function SectionChrome({ section, gap }: { section: LayoutSection; gap: number }): JSX.Element {
    const ed = useEditor();
    const selected = ed.selection?.kind === 'section' && ed.selection.id === section.id;
    const empty = section.blocks.every((c) => c.length === 0);
    const accent = useLayoutCtx().theme.accent;
    return (
        <section
            className={cn(
                'imcrm-group/s imcrm-relative imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-[14px] imcrm-outline imcrm-outline-2 imcrm-outline-offset-4 imcrm-transition-[outline-color]',
                selected ? 'imcrm-outline-primary' : 'imcrm-outline-dashed imcrm-outline-transparent hover:imcrm-outline-border',
            )}
            style={sectionStyle(section, accent)}
            data-testid="editor-section"
            onClick={(e) => {
                if (e.target === e.currentTarget) ed.select({ kind: 'section', id: section.id });
            }}
        >
            <div
                className={cn(
                    'imcrm-absolute imcrm--top-3.5 imcrm-right-2 imcrm-z-30 imcrm-flex imcrm-items-center imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-0.5 imcrm-shadow-imcrm-sm imcrm-transition-opacity',
                    selected ? 'imcrm-opacity-100' : 'imcrm-opacity-0 group-hover/s:imcrm-opacity-100',
                )}
            >
                <button
                    type="button"
                    className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                    onClick={() => ed.select({ kind: 'section', id: section.id })}
                >
                    {__('Sección')} · {section.columns.join('/')}
                </button>
                <ColumnsMenu section={section} />
                <ToolButton label={__('Subir')} onClick={() => ed.commit(moveSection(ed.layout, section.id, -1))}><ArrowUp /></ToolButton>
                <ToolButton label={__('Bajar')} onClick={() => ed.commit(moveSection(ed.layout, section.id, 1))}><ArrowDown /></ToolButton>
                <ToolButton label={__('Duplicar sección')} onClick={() => ed.commit(duplicateSection(ed.layout, section.id))}><Copy /></ToolButton>
                <ToolButton
                    label={__('Eliminar sección')}
                    danger
                    onClick={() => {
                        ed.commit(removeSection(ed.layout, section.id));
                        ed.select({ kind: 'page' });
                    }}
                >
                    <Trash2 />
                </ToolButton>
            </div>
            {section.title && <SectionTitle text={section.title} />}
            <div className="imcrm-lay-grid" style={{ gap }}>
                {section.columns.map((w, col) => {
                    const stack = section.blocks[col] ?? [];
                    return (
                        <div key={col} className="imcrm-lay-col imcrm-flex imcrm-min-w-0 imcrm-flex-col" style={{ ['--span' as string]: String(w) }} data-testid="editor-column">
                            <DropZone sectionId={section.id} col={col} index={0} grow={stack.length === 0 && empty} />
                            {stack.map((b, i) => (
                                <div key={b.id} className="imcrm-flex imcrm-flex-col">
                                    <BlockChrome block={b} />
                                    <DropZone sectionId={section.id} col={col} index={i + 1} />
                                </div>
                            ))}
                            <AddBlockMenu sectionId={section.id} col={col} index={stack.length} compact={stack.length > 0} />
                        </div>
                    );
                })}
            </div>
        </section>
    );
}

function ToolButton({ label, onClick, children, danger = false }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }): JSX.Element {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={(e) => {
                e.stopPropagation();
                onClick();
            }}
            className={cn(
                'imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground [&>svg]:imcrm-h-3.5 [&>svg]:imcrm-w-3.5',
                danger ? 'hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive' : 'hover:imcrm-bg-accent hover:imcrm-text-foreground',
            )}
        >
            {children}
        </button>
    );
}

/** Miniatura de un reparto de columnas (8/4 → dos barras de 2:1). */
export function ColumnsGlyph({ columns, active = false }: { columns: number[]; active?: boolean }): JSX.Element {
    return (
        <span className="imcrm-flex imcrm-h-5 imcrm-w-12 imcrm-gap-0.5">
            {columns.map((w, i) => (
                <span key={i} className={cn('imcrm-rounded-sm', active ? 'imcrm-bg-primary' : 'imcrm-bg-muted-foreground/40')} style={{ flex: w }} />
            ))}
        </span>
    );
}

function ColumnsMenu({ section }: { section: LayoutSection }): JSX.Element {
    const ed = useEditor();
    const current = section.columns.join(',');
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button type="button" title={__('Columnas')} aria-label={__('Columnas')} className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground" onClick={(e) => e.stopPropagation()}>
                    <Columns3 className="imcrm-h-3.5 imcrm-w-3.5" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="imcrm-w-[220px] imcrm-p-2">
                <p className="imcrm-mb-2 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground">{__('Columnas de la sección')}</p>
                <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-1.5">
                    {COLUMN_PRESETS.map((p) => (
                        <button
                            key={p.join(',')}
                            type="button"
                            className={cn('imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-p-1.5 imcrm-text-[10px]', current === p.join(',') ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-accent')}
                            onClick={() => ed.commit(setSectionColumns(ed.layout, section.id, p))}
                        >
                            <ColumnsGlyph columns={p} active={current === p.join(',')} />
                            {p.join('/')}
                        </button>
                    ))}
                </div>
            </PopoverContent>
        </Popover>
    );
}

function BlockChrome({ block }: { block: LayoutBlock }): JSX.Element {
    const ed = useEditor();
    const selected = ed.selection?.kind === 'block' && ed.selection.id === block.id;
    const [dragging, setDragging] = useState(false);
    const Icon = blockIcon(block);
    const move = (delta: -1 | 1): void => {
        const at = findBlock(ed.layout, block.id);
        if (!at) return;
        ed.commit(moveBlock(ed.layout, block.id, { ...at, index: Math.max(0, at.index + (delta === 1 ? 2 : -1)) }));
    };
    return (
        <div
            className={cn(
                'imcrm-group/b imcrm-relative imcrm-rounded-[14px] imcrm-outline imcrm-outline-2 imcrm-outline-offset-2 imcrm-transition-[outline-color,opacity]',
                selected ? 'imcrm-outline-primary' : 'imcrm-outline-transparent hover:imcrm-outline-primary/40',
                dragging && 'imcrm-opacity-40',
            )}
            data-testid="editor-block"
            data-block-id={block.id}
        >
            <div className="imcrm-pointer-events-none">
                <LayoutBlockView block={block} />
            </div>
            {/* Capa que toma el click y el arrastre: dentro del editor los
                bloques no se usan, se eligen (un iframe o un popover se
                comerían el click). */}
            <div
                role="button"
                tabIndex={0}
                aria-label={`${__('Elegir')} ${blockLabel(block)}`}
                draggable
                onDragStart={(e) => {
                    writeDrag(e, { move: block.id });
                    setDragging(true);
                }}
                onDragEnd={() => setDragging(false)}
                onClick={(e) => {
                    e.stopPropagation();
                    ed.select({ kind: 'block', id: block.id });
                }}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') ed.select({ kind: 'block', id: block.id });
                }}
                className="imcrm-absolute imcrm-inset-0 imcrm-z-10 imcrm-cursor-grab imcrm-rounded-[14px] focus-visible:imcrm-outline-none active:imcrm-cursor-grabbing"
            />
            <div
                className={cn(
                    'imcrm-absolute imcrm--top-3 imcrm-left-3 imcrm-z-20 imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-bg-primary imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-semibold imcrm-text-primary-foreground imcrm-transition-opacity',
                    selected ? 'imcrm-opacity-100' : 'imcrm-pointer-events-none imcrm-opacity-0 group-hover/b:imcrm-opacity-100',
                )}
            >
                <GripVertical className="imcrm-h-3 imcrm-w-3" />
                <Icon className="imcrm-h-3 imcrm-w-3" />
                {blockLabel(block)}
            </div>
            {selected && (
                <div className="imcrm-absolute imcrm--top-3.5 imcrm-right-2 imcrm-z-30 imcrm-flex imcrm-items-center imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-0.5 imcrm-shadow-imcrm-sm">
                    <ToolButton label={__('Subir')} onClick={() => move(-1)}><ArrowUp /></ToolButton>
                    <ToolButton label={__('Bajar')} onClick={() => move(1)}><ArrowDown /></ToolButton>
                    <ToolButton
                        label={__('Duplicar')}
                        onClick={() => {
                            const r = duplicateBlock(ed.layout, block.id);
                            ed.commit(r.layout);
                            if (r.newId) ed.select({ kind: 'block', id: r.newId });
                        }}
                    >
                        <Copy />
                    </ToolButton>
                    <ToolButton
                        label={__('Eliminar')}
                        danger
                        onClick={() => {
                            ed.commit(removeBlock(ed.layout, block.id));
                            ed.select(null);
                        }}
                    >
                        <Trash2 />
                    </ToolButton>
                </div>
            )}
        </div>
    );
}

/** Franja donde se suelta un bloque (se ilumina al pasar arrastrando). */
function DropZone({ sectionId, col, index, grow = false }: { sectionId: string; col: number; index: number; grow?: boolean }): JSX.Element {
    const ed = useEditor();
    const [over, setOver] = useState(false);
    return (
        <div
            data-testid="editor-dropzone"
            onDragOver={(e) => {
                if (!isLayoutDrag(e)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                const payload = readDrag(e);
                if (payload) ed.drop(payload, { pageId: ed.pageId, sectionId, col, index });
            }}
            className={cn(
                'imcrm-relative imcrm-transition-all',
                grow ? 'imcrm-min-h-[64px] imcrm-rounded-xl imcrm-border imcrm-border-dashed imcrm-border-border' : 'imcrm-h-3',
                over && (grow ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-h-8'),
            )}
        >
            {over && !grow && <span className="imcrm-absolute imcrm-inset-x-0 imcrm-top-1/2 imcrm-h-0.5 imcrm--translate-y-1/2 imcrm-rounded-full imcrm-bg-primary" />}
            {grow && <span className="imcrm-flex imcrm-h-full imcrm-min-h-[64px] imcrm-items-center imcrm-justify-center imcrm-text-xs imcrm-text-muted-foreground">{__('Suelta un bloque aquí')}</span>}
        </div>
    );
}

/** "+ Bloque" al pie de cada columna: el catálogo agrupado. */
function AddBlockMenu({ sectionId, col, index, compact }: { sectionId: string; col: number; index: number; compact: boolean }): JSX.Element {
    const ed = useEditor();
    const [open, setOpen] = useState(false);
    const categories = Object.keys(CATEGORY_LABEL) as CatalogCategory[];
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(
                        'imcrm-flex imcrm-items-center imcrm-justify-center imcrm-gap-1 imcrm-rounded-lg imcrm-text-xs imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-bg-accent hover:imcrm-text-foreground',
                        compact ? 'imcrm-h-7 imcrm-opacity-0 group-hover/s:imcrm-opacity-100' : 'imcrm-h-8',
                    )}
                    data-testid="editor-add-block"
                >
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Bloque')}
                </button>
            </PopoverTrigger>
            <PopoverContent align="center" className="imcrm-max-h-[min(380px,var(--radix-popover-content-available-height))] imcrm-w-[280px] imcrm-overflow-y-auto imcrm-p-1.5">
                {categories.map((cat) => (
                    <div key={cat} className="imcrm-mb-1">
                        <p className="imcrm-px-2 imcrm-pb-1 imcrm-pt-1.5 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{CATEGORY_LABEL[cat]}</p>
                        {BLOCK_CATALOG.filter((e) => e.category === cat).map((e) => (
                            <button
                                key={e.key}
                                type="button"
                                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-sm hover:imcrm-bg-accent"
                                onClick={() => {
                                    ed.drop({ new: e.key }, { pageId: ed.pageId, sectionId, col, index });
                                    setOpen(false);
                                }}
                            >
                                <e.icon className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                {e.label}
                            </button>
                        ))}
                    </div>
                ))}
            </PopoverContent>
        </Popover>
    );
}

function AddSectionBar(): JSX.Element {
    const ed = useEditor();
    const page = ed.layout.pages.find((p) => p.id === ed.pageId) ?? ed.layout.pages[0]!;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-3" data-testid="editor-add-section">
            <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Agregar una sección')}</span>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-justify-center imcrm-gap-1.5">
                {COLUMN_PRESETS.map((p) => (
                    <button
                        key={p.join(',')}
                        type="button"
                        className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1 imcrm-text-[11px] hover:imcrm-border-primary/50 hover:imcrm-bg-accent"
                        onClick={() => {
                            const r = insertSection(ed.layout, page.id, page.sections.length, p);
                            ed.commit(r.layout);
                            ed.select({ kind: 'section', id: r.id });
                        }}
                        title={p.join(' / ')}
                    >
                        <ColumnsGlyph columns={p} />
                    </button>
                ))}
            </div>
        </div>
    );
}
