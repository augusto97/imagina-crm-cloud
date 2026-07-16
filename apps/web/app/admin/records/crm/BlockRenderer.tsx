import { useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquare, StickyNote } from 'lucide-react';

import { CommentsPanel } from '@/admin/comments/CommentsPanel';
import { RecordFieldsForm } from '@/admin/records/RecordFieldsForm';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { ResolvedV2Block } from '@/lib/crmTemplates';
import type { RecordEntity } from '@/types/record';

import { ChartBlockView } from './blocks/ChartBlockView';
import { CompactFieldRow } from './CompactFieldRow';
import { KpiBlockView } from './blocks/KpiBlockView';
import {
    ActionButtonView,
    EmbedBlockView,
    FilesBlockView,
    MarkdownBlockView,
} from './blocks/SimpleBlockViews';
import { RecordHeader, type RecordHeaderData } from './RecordHeader';
import { RecordTimeline } from './RecordTimeline';
import { RelatedBlock as RelatedBlockView, StatsBlock as StatsBlockView } from './RightRail';

export interface BlockRendererProps {
    block: ResolvedV2Block;
    listId: number;
    recordId: number;
    currentUserId: number;
    isAdmin: boolean;
    values: Record<string, unknown>;
    onChange: (values: Record<string, unknown>) => void;
    fieldErrors?: Record<string, string>;
    record: RecordEntity;
    /**
     * Datos del header (qué campo es título, status fields, etc.) que
     * vienen del template-level `headerSpec`. El bloque `header` los
     * usa; los demás bloques los ignoran.
     */
    headerData?: RecordHeaderData;
}

/**
 * Renderea un bloque V2 según su tipo. Usado tanto por el
 * `RecordCrmLayout` (modo static, en la ficha real) como por la
 * preview del editor visual.
 */
export function BlockRenderer({
    block,
    listId,
    recordId,
    currentUserId,
    isAdmin,
    values,
    onChange,
    fieldErrors,
    record,
    headerData,
}: BlockRendererProps): JSX.Element | null {
    if (block.type === 'header') {
        // 0.57.36 — bloque de presentación, solo lectura. Las acciones
        // Guardar/Eliminar viven en la toolbar del registro (fuera del
        // template) y en el drawer.
        return (
            <RecordHeader
                record={record}
                data={headerData ?? { titleField: null, subtitleFields: [], statusFields: [], quickActions: [] }}
                style={block.config}
            />
        );
    }
    if (block.type === 'properties_group') {
        return <PropertiesGroupView block={block} listId={listId} recordId={recordId} values={values} onChange={onChange} fieldErrors={fieldErrors} />;
    }
    if (block.type === 'timeline') {
        return (
            <RecordTimeline
                listId={listId}
                recordId={recordId}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
            />
        );
    }
    if (block.type === 'stats') {
        return (
            <StatsBlockView
                listId={listId}
                record={record}
                mode={block.config.mode}
                items={block.config.items}
            />
        );
    }
    if (block.type === 'related') {
        return <RelatedBlockView field={block.config.field} record={record} />;
    }
    if (block.type === 'kpi') {
        return <KpiBlockView block={block} record={record} />;
    }
    if (block.type === 'chart') {
        return <ChartBlockView block={block} record={record} />;
    }
    if (block.type === 'files') {
        return <FilesBlockView block={block} record={record} />;
    }
    if (block.type === 'embed') {
        return <EmbedBlockView block={block} record={record} />;
    }
    if (block.type === 'action_button') {
        return <ActionButtonView block={block} record={record} />;
    }
    if (block.type === 'markdown') {
        return <MarkdownBlockView block={block} record={record} values={values} onChange={onChange} />;
    }
    if (block.type === 'notes') {
        // Resuelve el contenido según `source`: literal (igual para todos)
        // o field (lee `record.fields[slug]` como string). En modo field,
        // habilitamos edición inline — el admin debería poder modificar
        // las notas del registro directo desde la ficha sin ir al drawer.
        if (block.config.source === 'field' && block.config.field) {
            const slug = block.config.field.slug;
            const current = values[slug];
            return (
                <NotesView
                    title={block.config.title}
                    content={typeof current === 'string' ? current : ''}
                    editable={{
                        onChange: (next) => onChange({ ...values, [slug]: next }),
                        placeholder: __('Sin notas. Click para escribir…'),
                    }}
                />
            );
        }
        return <NotesView title={block.config.title} content={block.config.content} />;
    }
    if (block.type === 'divider') {
        return <DividerView label={block.config.label} />;
    }
    if (block.type === 'heading') {
        return <HeadingView text={block.config.text} level={block.config.level} />;
    }
    if (block.type === 'comments_thread') {
        return (
            <CommentsThreadView
                title={block.config.title}
                listId={listId}
                recordId={recordId}
                currentUserId={currentUserId}
                isAdmin={isAdmin}
            />
        );
    }
    if (block.type === 'nested_section') {
        // Renderea las sub-columnas como mini-fila con sub-bloques
        // recursivamente. Misma estructura HTML/CSS que el layout
        // top-level (.imcrm-row / .imcrm-row__cell) para consistencia
        // visual con el editor.
        const wrapperStyle: React.CSSProperties = {};
        if (block.config.padding) wrapperStyle.padding = block.config.padding;
        if (block.config.margin) wrapperStyle.margin = block.config.margin;
        return (
            <div className="imcrm-rows-layout" style={wrapperStyle}>
                <div className="imcrm-row">
                    {block.config.columns.map((col) => {
                        const basis = `${(col.width / 12) * 100}%`;
                        const colStyle: React.CSSProperties = {
                            flexBasis: basis,
                            maxWidth: basis,
                        };
                        if (col.padding) colStyle.padding = col.padding;
                        if (col.margin) colStyle.margin = col.margin;
                        return (
                            <div key={col.id} className="imcrm-row__cell" style={colStyle}>
                                {col.blocks.map((subBlock) => (
                                    <BlockRenderer
                                        key={subBlock.id}
                                        block={subBlock}
                                        listId={listId}
                                        recordId={recordId}
                                        currentUserId={currentUserId}
                                        isAdmin={isAdmin}
                                        values={values}
                                        onChange={onChange}
                                        fieldErrors={fieldErrors}
                                        record={record}
                                        headerData={headerData}
                                    />
                                ))}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }
    return null;
}

// --- properties_group view ---------------------------------------------------

function PropertiesGroupView({
    block,
    listId,
    recordId,
    values,
    onChange,
    fieldErrors,
}: {
    block: Extract<ResolvedV2Block, { type: 'properties_group' }>;
    listId: number;
    recordId?: number;
    values: Record<string, unknown>;
    onChange: (values: Record<string, unknown>) => void;
    fieldErrors?: Record<string, string>;
}): JSX.Element {
    const [open, setOpen] = useState(! block.config.collapsedByDefault);
    const Icon = block.config.icon;
    const compact = block.config.density === 'compact';
    const inline = block.config.variant === 'inline';

    const setValue = (slug: string, v: unknown): void => onChange({ ...values, [slug]: v });

    // Variante `inline`: sin card, sin header colapsable. Renderea el
    // título como label pequeño arriba (si hay) y los campos directamente.
    if (inline) {
        return (
            <section className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-gap-1.5">
                {block.config.label && (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-px-1 imcrm-text-[11px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
                        <Icon className="imcrm-h-3 imcrm-w-3" aria-hidden />
                        {__(block.config.label)}
                    </div>
                )}
                <FieldsContent
                    fields={block.config.fields}
                    listId={listId}
                    recordId={recordId}
                    values={values}
                    setValue={setValue}
                    onChange={onChange}
                    fieldErrors={fieldErrors}
                    compact={compact}
                />
            </section>
        );
    }

    return (
        <section className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
            <button
                type="button"
                onClick={() => setOpen((v) => ! v)}
                aria-expanded={open}
                className={cn(
                    'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-px-4 imcrm-py-2.5 imcrm-text-left imcrm-text-sm imcrm-font-medium imcrm-transition-colors',
                    'hover:imcrm-bg-accent/40',
                )}
            >
                {open ? (
                    <ChevronDown className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                ) : (
                    <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                )}
                <Icon className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                <span className="imcrm-flex-1">{__(block.config.label)}</span>
                <span className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-semibold imcrm-text-muted-foreground">
                    {block.config.fields.length}
                </span>
            </button>
            {open && (
                <div
                    className={cn(
                        'imcrm-flex-1 imcrm-overflow-y-auto imcrm-border-t imcrm-border-border',
                        compact ? '' : 'imcrm-px-4 imcrm-py-3',
                    )}
                >
                    <FieldsContent
                        fields={block.config.fields}
                        listId={listId}
                        recordId={recordId}
                        values={values}
                        setValue={setValue}
                        onChange={onChange}
                        fieldErrors={fieldErrors}
                        compact={compact}
                    />
                </div>
            )}
        </section>
    );
}

function FieldsContent({
    fields,
    listId,
    recordId,
    values,
    setValue,
    onChange,
    fieldErrors,
    compact,
}: {
    fields: FieldEntity[];
    listId: number;
    recordId?: number;
    values: Record<string, unknown>;
    setValue: (slug: string, v: unknown) => void;
    onChange: (values: Record<string, unknown>) => void;
    fieldErrors?: Record<string, string>;
    compact: boolean;
}): JSX.Element {
    if (fields.length === 0) {
        return (
            <p className="imcrm-px-4 imcrm-py-3 imcrm-text-xs imcrm-text-muted-foreground">
                {__('Grupo vacío. Editalo desde el template editor.')}
            </p>
        );
    }
    if (compact) {
        return (
            <div className="imcrm-flex imcrm-flex-col">
                {fields.map((f) => (
                    <CompactFieldRow
                        key={f.id}
                        field={f}
                        listId={listId}
                        recordId={recordId}
                        value={values[f.slug]}
                        onChange={(v) => setValue(f.slug, v)}
                        error={fieldErrors?.[f.slug]}
                    />
                ))}
            </div>
        );
    }
    return (
        <RecordFieldsForm
            listId={listId}
            recordId={recordId}
            fields={fields}
            values={values}
            onChange={onChange}
            fieldErrors={fieldErrors}
        />
    );
}

// --- notes view --------------------------------------------------------------

// --- divider view ------------------------------------------------------------

function DividerView({ label }: { label?: string }): JSX.Element {
    if (! label) {
        return (
            <div className="imcrm-flex imcrm-h-full imcrm-items-center" aria-hidden>
                <hr className="imcrm-w-full imcrm-border-0 imcrm-border-t imcrm-border-border" />
            </div>
        );
    }
    return (
        <div className="imcrm-flex imcrm-h-full imcrm-items-center imcrm-gap-3 imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground">
            <hr className="imcrm-flex-1 imcrm-border-0 imcrm-border-t imcrm-border-border" />
            <span className="imcrm-whitespace-nowrap">{label}</span>
            <hr className="imcrm-flex-1 imcrm-border-0 imcrm-border-t imcrm-border-border" />
        </div>
    );
}

// --- heading view ------------------------------------------------------------

function HeadingView({ text, level }: { text: string; level: 2 | 3 | 4 }): JSX.Element {
    const sizeClass =
        level === 2
            ? 'imcrm-text-lg imcrm-font-semibold'
            : level === 3
                ? 'imcrm-text-base imcrm-font-semibold'
                : 'imcrm-text-sm imcrm-font-medium imcrm-uppercase imcrm-tracking-wider imcrm-text-muted-foreground';
    const Tag = (`h${level}` as 'h2' | 'h3' | 'h4');
    return (
        <div className="imcrm-flex imcrm-h-full imcrm-items-center">
            <Tag className={cn('imcrm-tracking-tight', sizeClass)}>
                {text || (
                    <span className="imcrm-italic imcrm-text-muted-foreground/60">
                        {__('Sin título')}
                    </span>
                )}
            </Tag>
        </div>
    );
}

// --- comments thread view ----------------------------------------------------

function CommentsThreadView({
    title,
    listId,
    recordId,
    currentUserId,
    isAdmin,
}: {
    title?: string;
    listId: number;
    recordId: number;
    currentUserId: number;
    isAdmin: boolean;
}): JSX.Element {
    return (
        <section className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
            <header className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-py-2.5 imcrm-text-sm imcrm-font-semibold">
                <MessageSquare className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                {title || __('Comentarios')}
            </header>
            <div className="imcrm-flex-1 imcrm-overflow-hidden">
                {recordId > 0 ? (
                    <CommentsPanel
                        listId={listId}
                        recordId={recordId}
                        currentUserId={currentUserId}
                        isAdmin={isAdmin}
                    />
                ) : (
                    <div className="imcrm-flex imcrm-h-full imcrm-items-center imcrm-justify-center imcrm-p-4 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Seleccioná un record real arriba para previsualizar el hilo.')}
                    </div>
                )}
            </div>
        </section>
    );
}

function NotesView({
    title,
    content,
    editable,
}: {
    title: string;
    content: string;
    /** Cuando se pasa, el bloque se vuelve editable inline (modo
     *  source=field del admin). Sin esto, es solo lectura (modo
     *  literal o contexto sin permiso de edición). */
    editable?: {
        onChange: (next: string) => void;
        placeholder?: string;
    };
}): JSX.Element {
    return (
        <section className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-warning/30 imcrm-bg-warning/5 imcrm-p-4">
            <header className="imcrm-mb-2 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold imcrm-text-warning">
                <StickyNote className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                {title || __('Nota')}
            </header>
            {editable ? (
                <textarea
                    value={content}
                    onChange={(e) => editable.onChange(e.target.value)}
                    placeholder={editable.placeholder ?? __('Escribir…')}
                    className="imcrm-flex-1 imcrm-w-full imcrm-resize-none imcrm-rounded imcrm-border-0 imcrm-bg-transparent imcrm-p-0 imcrm-text-sm imcrm-leading-relaxed imcrm-text-foreground imcrm-outline-none focus:imcrm-ring-0 placeholder:imcrm-italic placeholder:imcrm-text-muted-foreground/70"
                />
            ) : (
                <div className="imcrm-flex-1 imcrm-overflow-y-auto imcrm-whitespace-pre-wrap imcrm-text-sm imcrm-leading-relaxed imcrm-text-foreground">
                    {content || (
                        <span className="imcrm-italic imcrm-text-muted-foreground">
                            {__('Bloque de notas vacío.')}
                        </span>
                    )}
                </div>
            )}
        </section>
    );
}
