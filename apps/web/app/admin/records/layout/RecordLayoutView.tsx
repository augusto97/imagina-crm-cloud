import { Fragment, useMemo, type CSSProperties, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, Check, Loader2, Paintbrush, Trash2 } from 'lucide-react';
import type { LayoutSection, RecordLayoutV3 } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { WidgetDataOverrideContext } from '@/hooks/useDashboards';
import { __ } from '@/lib/i18n';
import { CAP, useCanAny } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';
import type { RecordEntity } from '@/types/record';

import { lockedReasonsFor, useStoreRules } from '../storeRules';
import { LayoutBlockView } from './LayoutBlocks';
import { LayoutContext, type LayoutCtx } from './LayoutContext';
import { LayoutHeader } from './LayoutHeader';
import { resolveTheme } from './layoutTheme';
import { useLayoutData } from './useLayoutData';
import { useRecordAutosave } from './useRecordAutosave';
import { useRecordLayout, type LayoutOrigin } from './useRecordLayout';

interface Props {
    list: ListSummary;
    record: RecordEntity;
    fields: FieldEntity[];
    currentUserId: number;
    isAdmin: boolean;
    onDelete: () => void;
    deleting: boolean;
}

/**
 * v0.1.230 — La ficha del registro diseñada (plantillas v3). Reemplaza al
 * layout CRM por grid: cabecera con portada y etapas, pestañas, secciones
 * con columnas y bloques que muestran cada campo con la forma que le
 * corresponde, gráficos y tablas de los registros vinculados. Se guarda
 * sola, campo por campo.
 */
export function RecordLayoutView({ list, record, fields, currentUserId, isAdmin, onDelete, deleting }: Props): JSX.Element {
    const { layout, origin } = useRecordLayout(list, fields);
    const canEdit = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS);
    const canDesign = useCanAny(CAP.MANAGE_LISTS);
    const storeRules = useStoreRules();
    const save = useRecordAutosave(list.id, record);
    const { query, override } = useLayoutData(list.id, list.slug, record.id, layout);
    const lockedReasons = useMemo(() => lockedReasonsFor(storeRules, fields, save.values), [storeRules, fields, save.values]);
    const fieldsById = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);
    const theme = resolveTheme(layout?.theme);

    const ctx: LayoutCtx = {
        list,
        record,
        fields,
        fieldsById,
        values: save.values,
        setValue: save.setValue,
        errors: save.errors,
        lockedReasons,
        canEdit,
        theme,
        currentUserId,
        isAdmin,
        data: query.data,
        dataLoading: query.isLoading,
    };

    return (
        <LayoutContext.Provider value={ctx}>
            <WidgetDataOverrideContext.Provider value={override}>
                <div className="imcrm-lay-root imcrm-flex imcrm-flex-col" style={{ gap: theme.gap }} data-testid="imcrm-record-layout">
                    <Toolbar
                        list={list}
                        saving={save.saving}
                        onDelete={storeRules ? null : onDelete}
                        deleting={deleting}
                        canDesign={canDesign}
                        origin={origin}
                    />
                    {layout === null ? (
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-py-10 imcrm-text-sm imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Preparando la ficha…')}
                        </div>
                    ) : (
                        <LayoutBody layout={layout} />
                    )}
                </div>
            </WidgetDataOverrideContext.Provider>
        </LayoutContext.Provider>
    );
}

export interface LayoutBodyProps {
    layout: RecordLayoutV3;
    /** Pestaña controlada desde afuera (el editor); sin esto, `?tab=` de la URL. */
    pageId?: string;
    onPageChange?: (pageId: string) => void;
    /** El editor envuelve cabecera y secciones con sus controles. */
    renderHeader?: (header: ReactNode) => ReactNode;
    renderSection?: (section: LayoutSection, gap: number) => ReactNode;
    /** Algo al final de la página (el "+ Sección" del editor). */
    footer?: ReactNode;
}

/** Cabecera + pestañas + secciones de una plantilla (también la usa el editor). */
export function LayoutBody({ layout, pageId: controlled, onPageChange, renderHeader, renderSection, footer }: LayoutBodyProps): JSX.Element {
    const [params, setParams] = useSearchParams();
    const pageId = controlled ?? params.get('tab');
    const page = layout.pages.find((p) => p.id === pageId) ?? layout.pages[0]!;
    const gap = resolveTheme(layout.theme).gap;
    const header = <LayoutHeader header={layout.header} />;
    const goTo = (id: string): void => {
        if (onPageChange) return onPageChange(id);
        const next = new URLSearchParams(params);
        if (id === layout.pages[0]!.id) next.delete('tab');
        else next.set('tab', id);
        setParams(next, { replace: true });
    };
    return (
        <>
            {renderHeader ? renderHeader(header) : header}
            {layout.pages.length > 1 && (
                <nav className="imcrm-flex imcrm-gap-1 imcrm-overflow-x-auto imcrm-border-b imcrm-border-border" style={{ overflowY: 'hidden' }} aria-label={__('Secciones de la ficha')}>
                    {layout.pages.map((p) => {
                        const active = p.id === page.id;
                        return (
                            <button
                                key={p.id}
                                type="button"
                                onClick={() => goTo(p.id)}
                                className={cn(
                                    'imcrm--mb-px imcrm-whitespace-nowrap imcrm-border-b-2 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-transition-colors',
                                    active
                                        ? 'imcrm-border-primary imcrm-font-semibold imcrm-text-foreground'
                                        : 'imcrm-border-transparent imcrm-text-muted-foreground hover:imcrm-text-foreground',
                                )}
                                aria-current={active ? 'page' : undefined}
                            >
                                {p.name}
                            </button>
                        );
                    })}
                </nav>
            )}
            {page.sections.map((s) => (
                <Fragment key={`${page.id}:${s.id}`}>{renderSection ? renderSection(s, gap) : <SectionView section={s} gap={gap} />}</Fragment>
            ))}
            {footer}
        </>
    );
}

export function SectionView({ section, gap }: { section: LayoutSection; gap: number }): JSX.Element | null {
    if (section.blocks.every((col) => col.length === 0)) return null;
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-2" style={sectionStyle(section)}>
            {section.title && <SectionTitle text={section.title} />}
            <div className="imcrm-lay-grid" style={{ gap }}>
                {section.columns.map((w, i) => (
                    <div key={i} className="imcrm-lay-col imcrm-flex imcrm-min-w-0 imcrm-flex-col" style={{ gap, ['--span' as string]: String(w) }}>
                        {(section.blocks[i] ?? []).map((b) => (
                            <LayoutBlockView key={b.id} block={b} />
                        ))}
                    </div>
                ))}
            </div>
        </section>
    );
}

export function sectionStyle(section: LayoutSection): CSSProperties | undefined {
    const bg = typeof section.style?.bg === 'string' ? section.style.bg : undefined;
    return bg ? { background: bg, padding: 16, borderRadius: 14 } : undefined;
}

export function SectionTitle({ text }: { text: string }): JSX.Element {
    return <h2 className="imcrm-text-sm imcrm-font-semibold imcrm-tracking-tight imcrm-text-foreground">{text}</h2>;
}

function Toolbar({
    list,
    saving,
    onDelete,
    deleting,
    canDesign,
    origin,
}: {
    list: ListSummary;
    saving: boolean;
    onDelete: (() => void) | null;
    deleting: boolean;
    canDesign: boolean;
    origin: LayoutOrigin;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3">
            <Button asChild variant="ghost" size="sm" className="imcrm-gap-2 imcrm-text-muted-foreground">
                <Link to={`/lists/${list.slug}/records`}>
                    <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                    {list.name}
                </Link>
            </Button>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                <span className="imcrm-mr-2 imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground" aria-live="polite">
                    {saving ? (
                        <>
                            <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                            <span className="imcrm-hidden sm:imcrm-inline">{__('Guardando…')}</span>
                        </>
                    ) : (
                        <>
                            <Check className="imcrm-h-3.5 imcrm-w-3.5" />
                            <span className="imcrm-hidden sm:imcrm-inline">{__('Se guarda solo')}</span>
                        </>
                    )}
                </span>
                {canDesign && (
                    <Button asChild variant="ghost" size="sm" className="imcrm-gap-2" title={origin === 'auto' ? __('Diseño automático: personalizalo') : undefined}>
                        <Link to={`/lists/${list.slug}/template-editor`}>
                            <Paintbrush className="imcrm-h-4 imcrm-w-4" />
                            <span className="imcrm-hidden sm:imcrm-inline">{__('Diseñar ficha')}</span>
                        </Link>
                    </Button>
                )}
                {onDelete && (
                    <Button
                        variant="ghost"
                        size="sm"
                        className="imcrm-gap-2 imcrm-text-destructive hover:imcrm-text-destructive"
                        onClick={onDelete}
                        disabled={deleting}
                    >
                        <Trash2 className="imcrm-h-4 imcrm-w-4" />
                        <span className="imcrm-hidden sm:imcrm-inline">{__('Eliminar')}</span>
                    </Button>
                )}
            </div>
        </div>
    );
}
