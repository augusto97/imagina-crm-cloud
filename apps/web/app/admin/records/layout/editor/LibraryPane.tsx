import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, FileStack, Plus, Search, Trash2 } from 'lucide-react';
import { PORTAL_LAYOUT_BLOCK_TYPES } from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { BLOCK_CATALOG, CATEGORY_LABEL, blockIcon, blockLabel, type CatalogCategory } from './blockCatalog';
import { useEditor, writeDrag } from './editorState';
import { addPage, movePage, removePage, renamePage } from './layoutOps';

/**
 * v0.1.231 — Panel izquierdo del editor: la galería de bloques (se arrastran
 * al lienzo o se agregan con un clic donde está la selección) y la
 * estructura (pestañas de la ficha y el esquema de la página actual).
 */
export function LibraryPane({ onPageChange }: { onPageChange: (id: string) => void }): JSX.Element {
    const [tab, setTab] = useState<'blocks' | 'structure'>('blocks');
    return (
        <>
            <div className="imcrm-flex imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-p-1.5" role="tablist">
                {(['blocks', 'structure'] as const).map((t) => (
                    <button
                        key={t}
                        type="button"
                        role="tab"
                        aria-selected={tab === t}
                        onClick={() => setTab(t)}
                        className={cn(
                            'imcrm-flex-1 imcrm-rounded-md imcrm-py-1.5 imcrm-text-xs imcrm-font-medium',
                            tab === t ? 'imcrm-bg-accent imcrm-text-foreground' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                        )}
                    >
                        {t === 'blocks' ? __('Bloques') : __('Estructura')}
                    </button>
                ))}
            </div>
            <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto">{tab === 'blocks' ? <BlockLibrary /> : <Structure onPageChange={onPageChange} />}</div>
        </>
    );
}

function normalize(s: string): string {
    return s
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();
}

function BlockLibrary(): JSX.Element {
    const ed = useEditor();
    const [q, setQ] = useState('');
    const categories = Object.keys(CATEGORY_LABEL) as CatalogCategory[];
    const matches = useMemo(() => {
        const n = normalize(q.trim());
        // El portal no ofrece lo que no tiene sentido para un cliente.
        const pool = ed.catalog.target === 'portal' ? BLOCK_CATALOG.filter((e) => PORTAL_LAYOUT_BLOCK_TYPES.includes(e.type)) : BLOCK_CATALOG;
        return n === '' ? pool : pool.filter((e) => normalize(`${e.label} ${e.description}`).includes(n));
    }, [q, ed.catalog.target]);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-p-2.5">
            <div className="imcrm-relative">
                <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-1/2 imcrm-h-3.5 imcrm-w-3.5 imcrm--translate-y-1/2 imcrm-text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={__('Buscar bloque…')} className="imcrm-h-8 imcrm-pl-8 imcrm-text-sm" aria-label={__('Buscar bloque')} />
            </div>
            <p className="imcrm-px-0.5 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                {ed.catalog.target === 'portal'
                    ? __('Arrastra un bloque al portal o haz clic para agregarlo debajo de lo elegido.')
                    : __('Arrastra un bloque a la ficha o haz clic para agregarlo debajo de lo elegido.')}
            </p>
            {categories.map((cat) => {
                const entries = matches.filter((e) => e.category === cat);
                if (entries.length === 0) return null;
                return (
                    <div key={cat} className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <p className="imcrm-px-0.5 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{CATEGORY_LABEL[cat]}</p>
                        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-1.5">
                            {entries.map((e) => (
                                <button
                                    key={e.key}
                                    type="button"
                                    draggable
                                    onDragStart={(ev) => writeDrag(ev, { new: e.key })}
                                    onClick={() => ed.add(e.key)}
                                    title={e.description}
                                    data-testid={`library-${e.key}`}
                                    className="imcrm-flex imcrm-cursor-grab imcrm-flex-col imcrm-items-start imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-background imcrm-p-2 imcrm-text-left imcrm-transition-colors hover:imcrm-border-primary/50 hover:imcrm-bg-accent active:imcrm-cursor-grabbing"
                                >
                                    <e.icon className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" />
                                    <span className="imcrm-text-[11.5px] imcrm-font-medium imcrm-leading-tight">{e.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                );
            })}
            {matches.length === 0 && <p className="imcrm-py-6 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">{__('Ningún bloque coincide.')}</p>}
        </div>
    );
}

function Structure({ onPageChange }: { onPageChange: (id: string) => void }): JSX.Element {
    const ed = useEditor();
    const page = ed.layout.pages.find((p) => p.id === ed.pageId) ?? ed.layout.pages[0]!;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-p-2.5">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-px-0.5">
                    <p className="imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Pestañas')}</p>
                    <button
                        type="button"
                        className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[11px] imcrm-text-primary hover:imcrm-bg-accent"
                        onClick={() => {
                            const r = addPage(ed.layout, sprintf(__('Pestaña %d'), ed.layout.pages.length + 1));
                            ed.commit(r.layout);
                            onPageChange(r.id);
                            ed.select({ kind: 'page' });
                        }}
                        disabled={ed.layout.pages.length >= 12}
                        data-testid="structure-add-page"
                    >
                        <Plus className="imcrm-h-3 imcrm-w-3" /> {__('Pestaña')}
                    </button>
                </div>
                {ed.layout.pages.map((p, i) => (
                    <div
                        key={p.id}
                        className={cn(
                            'imcrm-group imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-px-1.5 imcrm-py-1',
                            p.id === page.id ? 'imcrm-border-primary/50 imcrm-bg-primary/5' : 'imcrm-border-transparent hover:imcrm-bg-accent',
                        )}
                    >
                        <FileStack className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                        <input
                            value={p.name}
                            onFocus={() => onPageChange(p.id)}
                            onChange={(e) => ed.commit(renamePage(ed.layout, p.id, e.target.value.slice(0, 60)), `page-name:${p.id}`)}
                            onBlur={(e) => {
                                if (e.target.value.trim() === '') ed.commit(renamePage(ed.layout, p.id, sprintf(__('Pestaña %d'), i + 1)));
                            }}
                            className="imcrm-min-w-0 imcrm-flex-1 imcrm-bg-transparent imcrm-text-sm imcrm-outline-none"
                            aria-label={__('Nombre de la pestaña')}
                        />
                        <MiniButton label={__('Subir')} onClick={() => ed.commit(movePage(ed.layout, p.id, -1))} disabled={i === 0}>
                            <ArrowUp />
                        </MiniButton>
                        <MiniButton label={__('Bajar')} onClick={() => ed.commit(movePage(ed.layout, p.id, 1))} disabled={i === ed.layout.pages.length - 1}>
                            <ArrowDown />
                        </MiniButton>
                        <MiniButton label={__('Eliminar pestaña')} onClick={() => ed.commit(removePage(ed.layout, p.id))} disabled={ed.layout.pages.length <= 1}>
                            <Trash2 />
                        </MiniButton>
                    </div>
                ))}
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <p className="imcrm-px-0.5 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{sprintf(__('Contenido de «%s»'), page.name)}</p>
                <OutlineItem selected={ed.selection?.kind === 'header'} onClick={() => ed.select({ kind: 'header' })} label={__('Cabecera')} depth={0} />
                {page.sections.map((s, si) => (
                    <div key={s.id} className="imcrm-flex imcrm-flex-col">
                        <OutlineItem
                            selected={ed.selection?.kind === 'section' && ed.selection.id === s.id}
                            onClick={() => ed.select({ kind: 'section', id: s.id })}
                            label={s.title || sprintf(__('Sección %d · %s'), si + 1, s.columns.join('/'))}
                            depth={0}
                        />
                        {s.blocks.flat().map((b) => {
                            const Icon = blockIcon(b);
                            return (
                                <OutlineItem
                                    key={b.id}
                                    selected={ed.selection?.kind === 'block' && ed.selection.id === b.id}
                                    onClick={() => ed.select({ kind: 'block', id: b.id })}
                                    label={b.title || blockLabel(b)}
                                    icon={<Icon className="imcrm-h-3 imcrm-w-3" />}
                                    depth={1}
                                />
                            );
                        })}
                    </div>
                ))}
            </div>
        </div>
    );
}

function OutlineItem({ selected, onClick, label, icon, depth }: { selected: boolean; onClick: () => void; label: string; icon?: React.ReactNode; depth: number }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'imcrm-flex imcrm-w-full imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-rounded imcrm-py-1 imcrm-pr-1.5 imcrm-text-left imcrm-text-xs',
                depth === 0 ? 'imcrm-pl-1.5 imcrm-font-medium' : 'imcrm-pl-5 imcrm-text-muted-foreground',
                selected ? 'imcrm-bg-primary/10 imcrm-text-foreground' : 'hover:imcrm-bg-accent',
            )}
        >
            {icon}
            <span className="imcrm-truncate">{label}</span>
        </button>
    );
}

function MiniButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            disabled={disabled}
            className="imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground imcrm-opacity-0 hover:imcrm-bg-accent hover:imcrm-text-foreground disabled:imcrm-hidden group-hover:imcrm-opacity-100 [&>svg]:imcrm-h-3 [&>svg]:imcrm-w-3"
        >
            {children}
        </button>
    );
}
