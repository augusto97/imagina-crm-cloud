import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, ImagePlus, Loader2, Plus, Trash2, X } from 'lucide-react';
import {
    COLUMN_RATIOS,
    DOC_BLOCK_LABELS,
    DOC_INNER_BLOCK_TYPES,
    type BlockStyle,
    type BorderStyle,
    type DocAlign,
    type DocBlock,
    type DocDesign,
    type DocImage,
    type DocInnerBlock,
    type DocInnerBlockType,
    type DocPadding,
    type DocTotalRow,
    type DocTotalSource,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api } from '@/cloud/session';
import { useFields } from '@/hooks/useFields';
import { useRelationPaths } from '@/hooks/useRelationPaths';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import {
    BackgroundSection,
    BlockStylePanel,
    BorderSection,
    Choice,
    ColorField,
    DesignClipboard,
    ElementSection,
    ImageFramePanel,
    NumberField,
    STYLE_KEYS,
    SpacingSection,
    StyleSection,
    TypographySection,
    styleEditor,
    styleHasAny,
    type QuickPreset,
} from '@/components/design/DesignStyleControls';

import { MergeTagInput, type MergeTagSection } from '../automations/MergeTagInput';
import {
    AlignControl,
    Check,
    Field,
    IconBtn,
    InspectorHeader,
    InspectorTabs,
    Segmented,
    type InspectorTab,
} from '../automations/email/EmailBlockInspector';
import { EmailTextEditor } from '../automations/email/EmailTextEditor';
import { makeDocInner, newTotalRowId } from './documentDesignOps';

/**
 * v0.1.266 — Ajustes del bloque elegido en el editor de documentos PDF
 * (ADR-S35). Cada cambio vuelve a pedir la vista previa al servidor: lo que
 * se ve es el PDF que va a salir.
 *
 * v0.1.273 — Igual que el editor de correos: pestañas «Contenido» y
 * «Estilo», y cada ajuste en un solo lugar (tamaño rápido + exacto en la
 * misma fila, color del texto dentro de «Texto», fondo y relleno juntos).
 */
export interface DocInspectorProps {
    block: DocBlock | DocInnerBlock;
    inColumn: boolean;
    /** v0.1.273 — el bloque de columnas que lo contiene (para volver a él). */
    parent?: { label: string; onSelect: () => void } | null;
    tab: InspectorTab;
    onTab: (tab: InspectorTab) => void;
    design: DocDesign;
    fields: FieldEntity[];
    listId: number;
    /** Variables propias del documento (filas de totales). */
    extraTags: MergeTagSection[];
    onPatch: (patch: Record<string, unknown>) => void;
    onMove: (delta: -1 | 1) => void;
    onDuplicate: () => void;
    onRemove: () => void;
    onSelect: (id: string) => void;
    onAppendToColumn: (columnIndex: number, block: DocInnerBlock) => void;
    onSetColumns: (count: 2 | 3) => void;
}

export function DocumentBlockInspector(p: DocInspectorProps): JSX.Element {
    const { block } = p;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="doc-inspector">
            <InspectorHeader
                label={__(DOC_BLOCK_LABELS[block.type])}
                parent={p.parent ?? null}
                actions={
                    <>
                        <IconBtn label={__('Subir')} onClick={() => p.onMove(-1)} icon={ArrowUp} />
                        <IconBtn label={__('Bajar')} onClick={() => p.onMove(1)} icon={ArrowDown} />
                        <IconBtn label={__('Duplicar')} onClick={p.onDuplicate} icon={Copy} />
                        <IconBtn label={__('Eliminar')} onClick={p.onRemove} icon={Trash2} danger />
                    </>
                }
            />
            <InspectorTabs tab={p.tab} onTab={p.onTab} content={contentFor(p)} style={styleFor(p)} />
        </div>
    );
}

function tagInput(p: DocInspectorProps, value: string, onChange: (v: string) => void, opts: { placeholder?: string; autoGrow?: boolean } = {}): JSX.Element {
    return (
        <MergeTagInput
            value={value}
            onChange={onChange}
            fields={p.fields}
            tagContext="document"
            extraTags={p.extraTags}
            placeholder={opts.placeholder}
            {...(opts.autoGrow ? { rows: 2, autoGrow: true } : {})}
        />
    );
}

// --- Contenido ---------------------------------------------------------------

function contentFor(p: DocInspectorProps): React.ReactNode {
    const { block, onPatch } = p;
    switch (block.type) {
        case 'header':
            return (
                <>
                    <Segmented<'split' | 'centered' | 'band'>
                        label={__('Forma')}
                        value={block.layout}
                        options={[
                            { value: 'split', label: __('Logo y título') },
                            { value: 'centered', label: __('Centrado') },
                            { value: 'band', label: __('Franja') },
                        ]}
                        onChange={(v) => onPatch({ layout: v })}
                    />
                    <DocImageField label={__('Logo')} value={block.logo} onChange={(logo) => onPatch({ logo })} allowBrand />
                    {block.logo.kind !== 'none' && (
                        <Field label={`${__('Ancho del logo')}: ${block.logo_width} pt`}>
                            <input
                                type="range"
                                min={40}
                                max={220}
                                step={10}
                                value={block.logo_width}
                                onChange={(e) => onPatch({ logo_width: Number(e.target.value) })}
                                className="imcrm-w-full"
                                aria-label={__('Ancho del logo')}
                            />
                        </Field>
                    )}
                    <Field label={__('Quién emite')} hint={__('Un dato por renglón: el primero va en negrita (nombre, NIT o C.C., dirección, teléfono).')}>
                        {tagInput(p, block.company, (v) => onPatch({ company: v }), { autoGrow: true })}
                    </Field>
                    <Field label={__('Título del documento')}>{tagInput(p, block.title, (v) => onPatch({ title: v }))}</Field>
                    <Field label={__('Número')} hint={__('Por ejemplo «N.º {{record.id}}» o el campo con el consecutivo.')}>
                        {tagInput(p, block.number, (v) => onPatch({ number: v }))}
                    </Field>
                    <Field label={__('Ciudad y fecha')} hint={__('«Bogotá, {{date.today|larga}}» → «Bogotá, 8 de octubre de 2026».')}>
                        {tagInput(p, block.date, (v) => onPatch({ date: v }))}
                    </Field>
                </>
            );
        case 'heading':
            return <Field label={__('Texto')}>{tagInput(p, block.text, (v) => onPatch({ text: v }))}</Field>;
        case 'text':
            return (
                <EmailTextEditor key={block.id} value={block.doc} onChange={(doc) => onPatch({ doc })} fields={p.fields} tagContext="document" extraTags={p.extraTags} />
            );
        case 'fields':
            return <FieldsContent {...p} />;
        case 'items':
            return <ItemsFields {...p} />;
        case 'totals':
            return <TotalsFields {...p} />;
        case 'image':
            return <DocImageField label={__('Imagen')} value={block.src} onChange={(src) => onPatch({ src })} allowBrand />;
        case 'qr':
            return (
                <>
                    <Field
                        label={__('Contenido del código')}
                        hint={__('Un enlace o un texto, con variables: el link de pago, la web de la empresa, el número del documento…')}
                    >
                        {tagInput(p, block.value, (v) => onPatch({ value: v }), { placeholder: 'https://…  o  {{link_de_pago}}' })}
                    </Field>
                    <Field label={__('Texto debajo (opcional)')}>
                        {tagInput(p, block.caption, (v) => onPatch({ caption: v }), { placeholder: __('Escaneá para pagar') })}
                    </Field>
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Si el contenido queda vacío para un registro (por ejemplo, sin link de pago), el código no se dibuja.')}
                    </p>
                </>
            );
        case 'spacer':
            return (
                <Field label={`${__('Alto')}: ${block.height} pt`}>
                    <input
                        type="range"
                        min={2}
                        max={160}
                        step={2}
                        value={block.height}
                        onChange={(e) => onPatch({ height: Number(e.target.value) })}
                        className="imcrm-w-full"
                        aria-label={__('Alto del espacio')}
                    />
                </Field>
            );
        case 'page_break':
            return <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Lo que viene después de este bloque arranca en una página nueva.')}</p>;
        case 'signature':
            return <SignatureFields {...p} />;
        case 'columns':
            return (
                <>
                    <Segmented<string>
                        label={__('Columnas')}
                        value={String(block.columns.length)}
                        options={[
                            { value: '2', label: __('Dos') },
                            { value: '3', label: __('Tres') },
                        ]}
                        onChange={(v) => p.onSetColumns(Number(v) as 2 | 3)}
                    />
                    {block.columns.map((col, ci) => (
                        <div key={ci} className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2">
                            <p className="imcrm-mb-1.5 imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                                {__('Columna')} {ci + 1}
                            </p>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                {col.blocks.map((ib) => (
                                    <button
                                        key={ib.id}
                                        type="button"
                                        onClick={() => p.onSelect(ib.id)}
                                        className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-rounded imcrm-bg-muted/40 imcrm-px-2 imcrm-py-1 imcrm-text-left imcrm-text-xs hover:imcrm-bg-accent"
                                    >
                                        {__(DOC_BLOCK_LABELS[ib.type])}
                                        <span className="imcrm-text-muted-foreground">{__('Editar')}</span>
                                    </button>
                                ))}
                                <AddInner onAdd={(t) => p.onAppendToColumn(ci, makeDocInner(t))} />
                            </div>
                        </div>
                    ))}
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('La proporción, la separación y el fondo de cada columna están en «Estilo».')}</p>
                </>
            );
        default:
            // El separador no tiene contenido: todo es estilo.
            return null;
    }
}

// --- Estilo ------------------------------------------------------------------

/** Relleno de un bloque con fondo (pt), como en el generador. */
const PAD: Record<DocPadding, number> = { none: 0, sm: 4, md: 8, lg: 14 };

/** Bloques con texto: muestran la sección «Texto». */
const DOC_TYPO_BLOCKS = new Set<string>(['header', 'heading', 'text', 'fields', 'items', 'totals', 'signature', 'qr']);

const DOC_TEXT_SIZE = { sm: -1.5, md: 0, lg: 2 } as const;

function styleFor(p: DocInspectorProps): React.ReactNode {
    const { block, onPatch, design } = p;
    if (block.type === 'spacer' || block.type === 'page_break') return null;
    const ed = styleEditor('pdf', block.style, (style) => onPatch({ style }));
    const t = design.theme;
    const base = t.font_size;
    const lh = t.line_height ?? 1.25;
    const typoModified = (...extra: unknown[]): boolean => styleHasAny(block.style, STYLE_KEYS.typography) || extra.some((x) => x != null && x !== false);
    const typoReset = (extra: Record<string, unknown> = {}): (() => void) => () => onPatch({ ...extra, style: ed.without(STYLE_KEYS.typography) });

    const sections: React.ReactNode[] = [];
    switch (block.type) {
        case 'heading': {
            const sizes = { 1: base + 10, 2: base + 5, 3: base + 0.5 } as const;
            const preset: QuickPreset = {
                label: __('Tamaño'),
                options: [
                    { value: '1', label: __('Grande'), title: `${sizes[1]} pt` },
                    { value: '2', label: __('Mediano'), title: `${sizes[2]} pt` },
                    { value: '3', label: __('Rótulo'), title: `${sizes[3]} pt` },
                ],
                current: block.style?.font_size == null ? String(block.level) : null,
                onPick: (v) => onPatch({ level: Number(v), style: ed.without(['font_size']) }),
            };
            sections.push(
                <TypographySection
                    key="typo"
                    editor={ed}
                    defaultOpen
                    inheritFontLabel={__('La de los títulos')}
                    defaults={{ size: sizes[block.level], lineHeight: 1.2 }}
                    sizePreset={preset}
                    modified={typoModified(block.color)}
                    onReset={typoReset({ color: null })}
                >
                    <ColorField label={__('Color del texto')} value={block.color} onChange={(v) => onPatch({ color: v })} placeholder={block.level === 3 ? t.accent : t.text} />
                    <AlignControl value={block.align} onChange={(v) => onPatch({ align: v })} />
                </TypographySection>,
            );
            break;
        }
        case 'text': {
            const sizes = { sm: base + DOC_TEXT_SIZE.sm, md: base, lg: base + DOC_TEXT_SIZE.lg };
            sections.push(
                <TypographySection
                    key="typo"
                    editor={ed}
                    defaultOpen
                    defaults={{ size: sizes[block.size], lineHeight: lh }}
                    sizePreset={{
                        label: __('Tamaño'),
                        options: [
                            { value: 'sm', label: __('Chica'), title: `${sizes.sm} pt` },
                            { value: 'md', label: __('Normal'), title: `${sizes.md} pt` },
                            { value: 'lg', label: __('Grande'), title: `${sizes.lg} pt` },
                        ],
                        current: block.style?.font_size == null ? block.size : null,
                        onPick: (v) => onPatch({ size: v, style: ed.without(['font_size']) }),
                    }}
                    modified={typoModified(block.color, block.paragraph_spacing)}
                    onReset={typoReset({ color: null, paragraph_spacing: null })}
                    footer={
                        <NumberField
                            label={__('Espacio entre párrafos')}
                            unit="pt"
                            min={0}
                            max={48}
                            value={block.paragraph_spacing}
                            onChange={(v) => onPatch({ paragraph_spacing: v })}
                            placeholder="auto"
                        />
                    }
                >
                    <ColorField label={__('Color del texto')} value={block.color} onChange={(v) => onPatch({ color: v })} placeholder={t.text} />
                    <Segmented<'left' | 'center' | 'right' | 'justify'>
                        label={__('Alineación')}
                        value={block.align}
                        options={[
                            { value: 'left', label: __('Izq.') },
                            { value: 'center', label: __('Centro') },
                            { value: 'right', label: __('Der.') },
                            { value: 'justify', label: __('Justif.') },
                        ]}
                        onChange={(v) => onPatch({ align: v })}
                    />
                </TypographySection>,
            );
            break;
        }
        case 'fields':
            sections.push(
                <ElementSection key="layout" title={__('Disposición')} testId="style-layout">
                    <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                        <Choice<'table' | 'stacked'>
                            label={__('Forma')}
                            value={block.layout}
                            options={[
                                { value: 'table', label: __('Tabla') },
                                { value: 'stacked', label: __('Etiqueta arriba') },
                            ]}
                            onChange={(v) => onPatch({ layout: v })}
                        />
                        <Choice<string>
                            label={__('Columnas')}
                            value={String(block.columns)}
                            options={[
                                { value: '1', label: __('Una') },
                                { value: '2', label: __('Dos') },
                            ]}
                            onChange={(v) => onPatch({ columns: Number(v) })}
                        />
                    </div>
                    {block.layout === 'table' && (
                        <>
                            <Field label={`${__('Ancho de los nombres')}: ${block.label_width ?? 40}%`}>
                                <input
                                    type="range"
                                    min={15}
                                    max={70}
                                    step={5}
                                    value={block.label_width ?? 40}
                                    onChange={(e) => onPatch({ label_width: Number(e.target.value) })}
                                    className="imcrm-w-full"
                                    aria-label={__('Ancho de la columna de nombres')}
                                />
                            </Field>
                            <Check label={__('Línea entre filas')} checked={block.lines !== false} onChange={(v) => onPatch({ lines: v ? undefined : false })} />
                        </>
                    )}
                </ElementSection>,
                <TypographySection
                    key="typo"
                    editor={ed}
                    defaults={{ size: base, lineHeight: lh }}
                    modified={typoModified(block.label_color, block.value_color)}
                    onReset={typoReset({ label_color: null, value_color: null })}
                >
                    <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                        <ColorField label={__('Color de los nombres')} value={block.label_color} onChange={(v) => onPatch({ label_color: v })} placeholder={t.muted} />
                        <ColorField label={__('Color de los valores')} value={block.value_color} onChange={(v) => onPatch({ value_color: v })} placeholder={t.text} />
                    </div>
                </TypographySection>,
            );
            break;
        case 'image':
            sections.push(
                <ImageFramePanel key="img" medium="pdf" value={block.frame} onChange={(frame) => onPatch({ frame })}>
                    <Field label={`${__('Ancho')}: ${block.width}%`}>
                        <input
                            type="range"
                            min={5}
                            max={100}
                            step={5}
                            value={block.width}
                            onChange={(e) => onPatch({ width: Number(e.target.value) })}
                            className="imcrm-w-full"
                            aria-label={__('Ancho de la imagen')}
                        />
                    </Field>
                    <AlignControl value={block.align} onChange={(v) => onPatch({ align: v })} />
                </ImageFramePanel>,
            );
            break;
        case 'qr':
            sections.push(
                <ElementSection key="qr" title={__('Código')} testId="style-qr">
                    <Field label={`${__('Tamaño')}: ${block.size} pt`}>
                        <input
                            type="range"
                            min={40}
                            max={240}
                            step={8}
                            value={block.size}
                            onChange={(e) => onPatch({ size: Number(e.target.value) })}
                            className="imcrm-w-full"
                            aria-label={__('Tamaño del código QR')}
                        />
                    </Field>
                    <AlignControl value={block.align} onChange={(v) => onPatch({ align: v })} />
                </ElementSection>,
            );
            break;
        case 'signature':
            sections.push(
                <ElementSection key="sig" title={__('Firma')} testId="style-signature">
                    <AlignControl value={block.align} onChange={(v) => onPatch({ align: v })} />
                    <Check label={__('Línea para firmar')} checked={block.line} onChange={(v) => onPatch({ line: v })} />
                </ElementSection>,
            );
            break;
        case 'divider':
            sections.push(
                <ElementSection key="line" title={__('Línea')} testId="style-line">
                    <ColorField label={__('Color de la línea')} value={block.color} onChange={(v) => onPatch({ color: v })} placeholder={t.border} />
                    <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                        <Choice<string>
                            label={__('Grosor')}
                            value={String(block.thickness)}
                            options={[0.5, 1, 2, 3].map((n) => ({ value: String(n), label: String(n).replace('.', ','), title: `${n} pt` }))}
                            onChange={(v) => onPatch({ thickness: Number(v) })}
                        />
                        <Choice<BorderStyle>
                            label={__('Tipo')}
                            value={block.line_style ?? 'solid'}
                            options={[
                                { value: 'solid', label: '———', title: __('Continua') },
                                { value: 'dashed', label: '– – –', title: __('Rayada') },
                                { value: 'dotted', label: '·····', title: __('Punteada') },
                            ]}
                            onChange={(v) => onPatch({ line_style: v === 'solid' ? undefined : v })}
                        />
                    </div>
                    <Field label={`${__('Largo')}: ${block.length ?? 100}%`}>
                        <input
                            type="range"
                            min={5}
                            max={100}
                            step={5}
                            value={block.length ?? 100}
                            onChange={(e) => onPatch({ length: Number(e.target.value) === 100 ? undefined : Number(e.target.value) })}
                            className="imcrm-w-full"
                            aria-label={__('Largo de la línea')}
                        />
                    </Field>
                    {(block.length ?? 100) < 100 && <AlignControl value={block.align ?? 'center'} onChange={(v) => onPatch({ align: v })} />}
                </ElementSection>,
            );
            break;
        case 'columns':
            sections.push(<ColumnsStyle key="cols" {...p} />);
            break;
        default:
            break;
    }

    // «Texto» genérico para los bloques con texto que no lo armaron arriba.
    if (DOC_TYPO_BLOCKS.has(block.type) && !['heading', 'text', 'fields'].includes(block.type)) {
        sections.push(
            <TypographySection
                key="typo"
                editor={ed}
                defaultOpen={block.type === 'header' || block.type === 'items' || block.type === 'totals'}
                defaults={{ size: base, lineHeight: lh }}
                inheritFontLabel={__('La del documento')}
            />,
        );
    }

    const legacy = PAD[block.padding ?? (block.background ? 'md' : 'none')];
    const boxed = styleHasAny(block.style, STYLE_KEYS.border) || styleHasAny(block.style, STYLE_KEYS.padding);
    const padDefault = boxed ? (block.background || (block.style?.border_width ?? 0) > 0 ? Math.max(legacy, 8) : 0) : block.background ? legacy : 0;
    sections.push(
        <BackgroundSection
            key="bg"
            editor={ed}
            background={block.background}
            onBackground={(v) => onPatch({ background: v })}
            onReset={() => onPatch({ background: null })}
        />,
        <SpacingSection
            key="space"
            editor={ed}
            defaults={{ padding: padDefault, margin: undefined }}
            preset={
                block.background
                    ? {
                          label: __('Relleno con el fondo'),
                          options: (['sm', 'md', 'lg'] as const).map((v) => ({
                              value: v,
                              label: { sm: __('Poco'), md: __('Medio'), lg: __('Mucho') }[v],
                              title: `${PAD[v]} pt`,
                          })),
                          current: styleHasAny(block.style, STYLE_KEYS.padding) ? null : (block.padding ?? 'md'),
                          onPick: (v) => onPatch({ padding: v, style: ed.without(STYLE_KEYS.padding) }),
                      }
                    : undefined
            }
            modified={styleHasAny(block.style, STYLE_KEYS.spacing) || block.padding != null}
            onReset={() => onPatch({ padding: undefined, style: ed.without(STYLE_KEYS.spacing) })}
        />,
    );
    if (block.type !== 'image' || styleHasAny(block.style, STYLE_KEYS.border)) {
        sections.push(<BorderSection key="border" editor={ed} title={block.type === 'image' ? __('Borde del bloque') : undefined} />);
    }

    return (
        <>
            <DesignClipboard value={block.style} onPaste={(style) => onPatch({ style })} />
            {sections}
        </>
    );
}

function ColumnsStyle(p: DocInspectorProps): JSX.Element {
    const block = p.block as Extract<DocBlock, { type: 'columns' }>;
    const { onPatch } = p;
    return (
        <>
            <ElementSection title={__('Columnas')} testId="style-columns">
                <div className="imcrm-grid imcrm-grid-cols-[1fr_auto] imcrm-gap-2">
                    <Choice<string>
                        label={__('Proporción')}
                        value={block.ratio && block.ratio.split('-').length === block.columns.length ? block.ratio : block.columns.length === 2 ? '1-1' : '1-1-1'}
                        options={COLUMN_RATIOS[block.columns.length as 2 | 3].map((r) => ({ value: r, label: r.split('-').join(':') }))}
                        onChange={(v) => onPatch({ ratio: v === '1-1' || v === '1-1-1' ? undefined : v })}
                    />
                    <NumberField className="imcrm-w-20" label={__('Separación')} unit="pt" min={0} max={48} value={block.gap} onChange={(v) => onPatch({ gap: v == null ? undefined : Math.round(v) })} placeholder="16" />
                </div>
            </ElementSection>
            {block.columns.map((col, ci) => (
                <DocColumnBoxEditor
                    key={ci}
                    index={ci}
                    background={col.background ?? null}
                    style={col.style}
                    onChange={(patch) => onPatch({ columns: block.columns.map((c, i) => (i === ci ? { ...c, ...patch } : c)) })}
                />
            ))}
        </>
    );
}

/** Fondo y recuadro de UNA columna del PDF (plegado). */
function DocColumnBoxEditor({
    index,
    background,
    style,
    onChange,
}: {
    index: number;
    background: string | null;
    style: BlockStyle | undefined;
    onChange: (patch: { background?: string | null; style?: BlockStyle }) => void;
}): JSX.Element {
    return (
        <StyleSection
            title={`${__('Fondo de la columna')} ${index + 1}`}
            modified={!!background || !!style}
            onReset={() => onChange({ background: null, style: undefined })}
        >
            <ColorField label={__('Color de fondo')} value={background} onChange={(v) => onChange({ background: v })} />
            <BlockStylePanel medium="pdf" value={style} onChange={(st) => onChange({ style: st })} box />
        </StyleSection>
    );
}

function AddInner({ onAdd }: { onAdd: (type: DocInnerBlockType) => void }): JSX.Element {
    const [open, setOpen] = useState(false);
    if (!open) {
        return (
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-text-primary hover:imcrm-bg-primary/10"
            >
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Agregar a esta columna')}
            </button>
        );
    }
    return (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
            {DOC_INNER_BLOCK_TYPES.map((t) => (
                <button
                    key={t}
                    type="button"
                    onClick={() => {
                        onAdd(t);
                        setOpen(false);
                    }}
                    className="imcrm-rounded imcrm-border imcrm-border-border imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] hover:imcrm-bg-accent"
                >
                    {__(DOC_BLOCK_LABELS[t])}
                </button>
            ))}
        </div>
    );
}

// ── Imagen (logo, sello, firma escaneada) ─────────────────────────────────

export function DocImageField({
    label,
    value,
    onChange,
    allowBrand,
}: {
    label: string;
    value: DocImage;
    onChange: (img: DocImage) => void;
    allowBrand?: boolean;
}): JSX.Element {
    const toast = useToast();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [uploading, setUploading] = useState(false);
    const upload = async (file: File): Promise<void> => {
        setUploading(true);
        try {
            const { id } = await api.uploadFile(file);
            onChange({ kind: 'file', file_id: id, url: '' });
            toast.success(__('Imagen subida'));
        } catch (err) {
            toast.error(__('No se pudo subir la imagen'), err instanceof Error ? err.message : String(err));
        } finally {
            setUploading(false);
        }
    };
    return (
        <Field label={label} hint={__('PNG o JPG: los formatos que acepta un PDF.')}>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <Segmented<DocImage['kind']>
                    label={__('De dónde sale')}
                    value={value.kind}
                    options={[
                        { value: 'none', label: __('Ninguna') },
                        ...(allowBrand ? [{ value: 'brand' as const, label: __('Logo de la marca') }] : []),
                        { value: 'file', label: __('Subida') },
                        { value: 'url', label: __('Enlace') },
                    ]}
                    onChange={(kind) => onChange({ ...value, kind })}
                />
                {value.kind === 'brand' && (
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('El logo que cargaste en Ajustes → Marca. Si no hay, no se muestra nada.')}</p>
                )}
                {value.kind === 'file' && (
                    <>
                        <input
                            ref={inputRef}
                            type="file"
                            accept="image/png,image/jpeg"
                            className="imcrm-hidden"
                            onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) void upload(f);
                                e.target.value = '';
                            }}
                        />
                        <Button type="button" variant="outline" size="sm" className="imcrm-gap-1.5" disabled={uploading} onClick={() => inputRef.current?.click()}>
                            {uploading ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <ImagePlus className="imcrm-h-3.5 imcrm-w-3.5" />}
                            {value.file_id ? __('Cambiar imagen') : __('Subir imagen')}
                        </Button>
                    </>
                )}
                {value.kind === 'url' && (
                    <Input value={value.url} onChange={(e) => onChange({ ...value, url: e.target.value })} placeholder="https://…/logo.png" />
                )}
            </div>
        </Field>
    );
}

// ── Datos del registro ────────────────────────────────────────────────────

const HIDDEN_TYPES = new Set(['relation', 'file']);

function FieldPicker({
    fields,
    selected,
    onChange,
}: {
    fields: FieldEntity[];
    selected: string[];
    onChange: (slugs: string[]) => void;
}): JSX.Element {
    const usable = fields.filter((f) => !HIDDEN_TYPES.has(f.type));
    return (
        <div className="imcrm-flex imcrm-max-h-56 imcrm-flex-col imcrm-gap-0.5 imcrm-overflow-y-auto imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-1">
            {usable.length === 0 && <p className="imcrm-p-2 imcrm-text-xs imcrm-text-muted-foreground">{__('No hay campos para mostrar.')}</p>}
            {usable.map((f) => {
                const idx = selected.indexOf(f.slug);
                return (
                    <label key={f.id} className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-2 imcrm-py-1 imcrm-text-xs hover:imcrm-bg-accent">
                        <input
                            type="checkbox"
                            checked={idx >= 0}
                            onChange={() => onChange(idx >= 0 ? selected.filter((s) => s !== f.slug) : [...selected, f.slug])}
                        />
                        <span className="imcrm-flex-1 imcrm-truncate">{f.label}</span>
                        {idx >= 0 && <span className="imcrm-text-[10px] imcrm-text-muted-foreground">#{idx + 1}</span>}
                    </label>
                );
            })}
        </div>
    );
}

function FieldsContent(p: DocInspectorProps): JSX.Element {
    const block = p.block as Extract<DocBlock, { type: 'fields' }>;
    return (
        <>
            <Field label={__('Título (opcional)')}>{tagInput(p, block.title, (v) => p.onPatch({ title: v }))}</Field>
            <Field label={__('Campos a mostrar')} hint={__('Con el valor como se lee en la ficha: montos, fechas y opciones legibles.')}>
                <FieldPicker fields={p.fields} selected={block.slugs} onChange={(slugs) => p.onPatch({ slugs })} />
            </Field>
        </>
    );
}

// ── Tabla de ítems ────────────────────────────────────────────────────────

function ItemsFields(p: DocInspectorProps): JSX.Element {
    const block = p.block as Extract<DocBlock, { type: 'items' }>;
    const paths = useRelationPaths(p.listId);
    const itemFields = useFields(block.source?.list_id);
    const fields = (itemFields.data ?? []).filter((f) => !HIDDEN_TYPES.has(f.type));
    const sourceKey = block.source ? `${block.source.relation_field_id}:${block.source.direction}` : '';
    const label = (slug: string): string => fields.find((f) => f.slug === slug)?.label ?? slug;
    const setColumns = (columns: typeof block.columns): void => p.onPatch({ columns });

    return (
        <>
            <Field label={__('Título (opcional)')}>{tagInput(p, block.title, (v) => p.onPatch({ title: v }))}</Field>
            <Field
                label={__('Filas: registros vinculados de')}
                hint={__('Las líneas del documento salen de otra lista vinculada a este registro (servicios, productos, cuotas).')}
            >
                <Select
                    value={sourceKey}
                    onChange={(e) => {
                        const [fid, dir] = e.target.value.split(':');
                        const path = (paths.data ?? []).find((x) => String(x.relation_field_id) === fid && x.direction === dir);
                        p.onPatch({
                            source: path ? { relation_field_id: path.relation_field_id, direction: path.direction, list_id: path.other_list_id } : null,
                            columns: [],
                            sort: null,
                        });
                    }}
                >
                    <option value="">{__('Elegí una relación…')}</option>
                    {(paths.data ?? []).map((x) => (
                        <option key={`${x.relation_field_id}:${x.direction}`} value={`${x.relation_field_id}:${x.direction}`}>
                            {x.other_list_name} ({__('por')} «{x.relation_label}»)
                        </option>
                    ))}
                </Select>
                {paths.data && paths.data.length === 0 && (
                    <p className="imcrm-text-[11px] imcrm-text-amber-700 dark:imcrm-text-amber-300">
                        {__('Esta lista no tiene relaciones con otras listas. Creá un campo «Relación» para vincular los ítems.')}
                    </p>
                )}
            </Field>

            {block.source && (
                <Field label={__('Columnas')} hint={__('En el orden en que aparecen. «Llena» toma el ancho que sobra (la descripción).')}>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        {block.columns.map((c, i) => (
                            <div key={`${c.slug}-${i}`} className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2">
                                <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                    <span className="imcrm-flex-1 imcrm-truncate imcrm-text-xs imcrm-font-medium">{label(c.slug)}</span>
                                    <IconBtn
                                        label={__('Subir')}
                                        icon={ArrowUp}
                                        onClick={() => {
                                            if (i === 0) return;
                                            const next = [...block.columns];
                                            [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                                            setColumns(next);
                                        }}
                                    />
                                    <IconBtn label={__('Quitar')} icon={X} danger onClick={() => setColumns(block.columns.filter((_, k) => k !== i))} />
                                </div>
                                <Input
                                    value={c.label}
                                    placeholder={label(c.slug)}
                                    onChange={(e) => setColumns(block.columns.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)))}
                                    className="imcrm-h-7 imcrm-text-xs"
                                    aria-label={__('Encabezado de la columna')}
                                />
                                <div className="imcrm-flex imcrm-gap-1">
                                    <Select
                                        value={c.align}
                                        onChange={(e) => setColumns(block.columns.map((x, k) => (k === i ? { ...x, align: e.target.value as DocAlign } : x)))}
                                        className="imcrm-h-7 imcrm-text-xs"
                                        aria-label={__('Alineación')}
                                    >
                                        <option value="left">{__('Izquierda')}</option>
                                        <option value="center">{__('Centro')}</option>
                                        <option value="right">{__('Derecha')}</option>
                                    </Select>
                                    <Select
                                        value={c.width}
                                        onChange={(e) => setColumns(block.columns.map((x, k) => (k === i ? { ...x, width: e.target.value as 'auto' | 'fill' } : x)))}
                                        className="imcrm-h-7 imcrm-text-xs"
                                        aria-label={__('Ancho')}
                                    >
                                        <option value="auto">{__('Justa')}</option>
                                        <option value="fill">{__('Llena')}</option>
                                    </Select>
                                </div>
                            </div>
                        ))}
                        <Select
                            value=""
                            onChange={(e) => {
                                const f = fields.find((x) => x.slug === e.target.value);
                                if (!f) return;
                                const numeric = ['number', 'currency', 'percent', 'computed', 'rollup'].includes(f.type);
                                setColumns([...block.columns, { slug: f.slug, label: '', align: numeric ? 'right' : 'left', width: block.columns.length === 0 ? 'fill' : 'auto' }]);
                            }}
                            aria-label={__('Agregar columna')}
                        >
                            <option value="">{__('+ Agregar columna…')}</option>
                            {fields
                                .filter((f) => !block.columns.some((c) => c.slug === f.slug))
                                .map((f) => (
                                    <option key={f.id} value={f.slug}>
                                        {f.label}
                                    </option>
                                ))}
                        </Select>
                    </div>
                </Field>
            )}

            {block.source && (
                <>
                    <Field label={__('Ordenar por')}>
                        <div className="imcrm-flex imcrm-gap-1">
                            <Select
                                value={block.sort?.slug ?? ''}
                                onChange={(e) => p.onPatch({ sort: e.target.value ? { slug: e.target.value, dir: block.sort?.dir ?? 'asc' } : null })}
                            >
                                <option value="">{__('Como se crearon')}</option>
                                {fields.map((f) => (
                                    <option key={f.id} value={f.slug}>
                                        {f.label}
                                    </option>
                                ))}
                            </Select>
                            {block.sort && (
                                <Select value={block.sort.dir} onChange={(e) => p.onPatch({ sort: { ...block.sort!, dir: e.target.value } })} className="imcrm-w-32">
                                    <option value="asc">{__('Ascendente')}</option>
                                    <option value="desc">{__('Descendente')}</option>
                                </Select>
                            )}
                        </div>
                    </Field>
                    <Check label={__('Numerar las filas (#)')} checked={block.numbered} onChange={(v) => p.onPatch({ numbered: v })} />
                    <Check label={__('Filas alternadas')} checked={block.striped} onChange={(v) => p.onPatch({ striped: v })} />
                    <Field label={__('Si no hay ítems')}>
                        <Input value={block.empty_text} onChange={(e) => p.onPatch({ empty_text: e.target.value })} />
                    </Field>
                </>
            )}
        </>
    );
}

// ── Totales ──────────────────────────────────────────────────────────────

const NUMERIC = new Set(['number', 'currency', 'percent', 'computed', 'rollup', 'lookup']);

function TotalsFields(p: DocInspectorProps): JSX.Element {
    const block = p.block as Extract<DocBlock, { type: 'totals' }>;
    const itemsBlocks = p.design.blocks.filter((b): b is Extract<DocBlock, { type: 'items' }> => b.type === 'items');
    const setRows = (rows: DocTotalRow[]): void => p.onPatch({ rows });
    const patchRow = (i: number, patch: Partial<DocTotalRow>): void => setRows(block.rows.map((r, k) => (k === i ? { ...r, ...patch } : r)));
    return (
        <>
            <p className="imcrm-text-[11px] imcrm-leading-relaxed imcrm-text-muted-foreground">
                {__('Cada fila se calcula sola: la suma de una columna de la tabla, un campo del registro, un porcentaje de otra fila (IVA) o la suma de varias. En el texto podés usar {{totales.total|pesos}} para escribir el monto en letras.')}
            </p>
            {block.rows.map((row, i) => (
                <div key={i} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2" data-total-row={row.id}>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                        <Input value={row.label} onChange={(e) => patchRow(i, { label: e.target.value })} className="imcrm-h-7 imcrm-flex-1 imcrm-text-xs" aria-label={__('Nombre de la fila')} />
                        <span className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-[10px] imcrm-text-muted-foreground" title={__('Variable: {{totales.id}}')}>
                            {row.id}
                        </span>
                        <IconBtn
                            label={__('Subir')}
                            icon={ArrowUp}
                            onClick={() => {
                                if (i === 0) return;
                                const next = [...block.rows];
                                [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                                setRows(next);
                            }}
                        />
                        <IconBtn label={__('Quitar')} icon={X} danger onClick={() => setRows(block.rows.filter((_, k) => k !== i))} />
                    </div>
                    <Select
                        value={row.source.kind}
                        onChange={(e) => patchRow(i, { source: defaultSource(e.target.value as DocTotalSource['kind'], block, itemsBlocks, p.fields) })}
                        className="imcrm-h-7 imcrm-text-xs"
                        aria-label={__('Cómo se calcula')}
                    >
                        <option value="items_sum">{__('Suma de una columna de la tabla')}</option>
                        <option value="field">{__('Un campo del registro')}</option>
                        <option value="percent">{__('Porcentaje de otra fila (IVA, retención)')}</option>
                        <option value="sum">{__('Suma de otras filas')}</option>
                        <option value="text">{__('Texto escrito')}</option>
                    </Select>
                    <TotalSourceEditor row={row} block={block} itemsBlocks={itemsBlocks} fields={p.fields} onChange={(source) => patchRow(i, { source })} />
                    <Check label={__('Destacada (el total)')} checked={row.emphasis} onChange={(v) => patchRow(i, { emphasis: v })} />
                </div>
            ))}
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="imcrm-gap-1.5"
                onClick={() => setRows([...block.rows, { id: newTotalRowId(p.design), label: __('Nueva fila'), source: defaultSource('field', block, itemsBlocks, p.fields), emphasis: false }])}
                disabled={block.rows.length >= 12}
            >
                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Agregar fila')}
            </Button>
            <Segmented<'half' | 'full'>
                label={__('Ancho')}
                value={block.width}
                options={[
                    { value: 'half', label: __('A la derecha') },
                    { value: 'full', label: __('Todo el ancho') },
                ]}
                onChange={(v) => p.onPatch({ width: v })}
            />
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <Field label={__('Antes del número')}>
                    <Input value={block.prefix} onChange={(e) => p.onPatch({ prefix: e.target.value })} className="imcrm-h-8" />
                </Field>
                <Field label={__('Decimales')}>
                    <Select value={String(block.decimals)} onChange={(e) => p.onPatch({ decimals: Number(e.target.value) })} className="imcrm-h-8">
                        {[0, 1, 2, 3, 4].map((n) => (
                            <option key={n} value={n}>
                                {n}
                            </option>
                        ))}
                    </Select>
                </Field>
            </div>
        </>
    );
}

function defaultSource(
    kind: DocTotalSource['kind'],
    block: Extract<DocBlock, { type: 'totals' }>,
    itemsBlocks: Array<Extract<DocBlock, { type: 'items' }>>,
    fields: FieldEntity[],
): DocTotalSource {
    switch (kind) {
        case 'items_sum': {
            const it = itemsBlocks[0];
            const col = it?.columns[it.columns.length - 1];
            return { kind, block_id: it?.id ?? '', slug: col?.slug ?? '' };
        }
        case 'field':
            return { kind, slug: fields.find((f) => NUMERIC.has(f.type))?.slug ?? '' };
        case 'percent':
            return { kind, of: block.rows[0]?.id ?? '', pct: 19 };
        case 'sum':
            return { kind, rows: block.rows.map((r) => r.id), minus: [] };
        case 'text':
            return { kind, value: '' };
    }
}

function TotalSourceEditor({
    row,
    block,
    itemsBlocks,
    fields,
    onChange,
}: {
    row: DocTotalRow;
    block: Extract<DocBlock, { type: 'totals' }>;
    itemsBlocks: Array<Extract<DocBlock, { type: 'items' }>>;
    fields: FieldEntity[];
    onChange: (s: DocTotalSource) => void;
}): JSX.Element | null {
    const s = row.source;
    const others = block.rows.filter((r) => r.id !== row.id);
    const cls = 'imcrm-h-7 imcrm-text-xs';
    switch (s.kind) {
        case 'items_sum': {
            const it = itemsBlocks.find((b) => b.id === s.block_id) ?? itemsBlocks[0];
            if (!it) return <p className="imcrm-text-[11px] imcrm-text-amber-700">{__('Agregá antes una tabla de ítems.')}</p>;
            return (
                <Select value={s.slug} onChange={(e) => onChange({ ...s, block_id: it.id, slug: e.target.value })} className={cls} aria-label={__('Columna a sumar')}>
                    <option value="">{__('Elegí la columna…')}</option>
                    {it.columns.map((c) => (
                        <option key={c.slug} value={c.slug}>
                            {c.label || c.slug}
                        </option>
                    ))}
                </Select>
            );
        }
        case 'field':
            return (
                <Select value={s.slug} onChange={(e) => onChange({ ...s, slug: e.target.value })} className={cls} aria-label={__('Campo')}>
                    <option value="">{__('Elegí el campo…')}</option>
                    {fields
                        .filter((f) => NUMERIC.has(f.type))
                        .map((f) => (
                            <option key={f.id} value={f.slug}>
                                {f.label}
                            </option>
                        ))}
                </Select>
            );
        case 'percent':
            return (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                    <Input
                        type="number"
                        value={s.pct}
                        onChange={(e) => onChange({ ...s, pct: Math.max(-100, Math.min(100, Number(e.target.value) || 0)) })}
                        className={cn(cls, 'imcrm-w-20')}
                        aria-label={__('Porcentaje')}
                    />
                    <span className="imcrm-text-xs">% {__('de')}</span>
                    <Select value={s.of} onChange={(e) => onChange({ ...s, of: e.target.value })} className={cls} aria-label={__('Fila base')}>
                        {others.map((r) => (
                            <option key={r.id} value={r.id}>
                                {r.label || r.id}
                            </option>
                        ))}
                    </Select>
                </div>
            );
        case 'sum':
            return (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                    {others.map((r) => {
                        const state = s.rows.includes(r.id) ? 'plus' : s.minus.includes(r.id) ? 'minus' : 'off';
                        return (
                            <label key={r.id} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                                <Select
                                    value={state}
                                    onChange={(e) => {
                                        const v = e.target.value;
                                        const rows = s.rows.filter((x) => x !== r.id);
                                        const minus = s.minus.filter((x) => x !== r.id);
                                        if (v === 'plus') rows.push(r.id);
                                        if (v === 'minus') minus.push(r.id);
                                        onChange({ ...s, rows, minus });
                                    }}
                                    className={cn(cls, 'imcrm-w-24')}
                                >
                                    <option value="off">—</option>
                                    <option value="plus">{__('suma')}</option>
                                    <option value="minus">{__('resta')}</option>
                                </Select>
                                {r.label || r.id}
                            </label>
                        );
                    })}
                </div>
            );
        case 'text':
            return (
                <Textarea value={s.value} onChange={(e) => onChange({ ...s, value: e.target.value })} rows={1} className="imcrm-text-xs" aria-label={__('Texto')} />
            );
    }
}

// ── Firma ────────────────────────────────────────────────────────────────

function SignatureFields(p: DocInspectorProps): JSX.Element {
    const block = p.block as Extract<DocBlock, { type: 'signature' }>;
    const set = (signers: typeof block.signers): void => p.onPatch({ signers });
    return (
        <>
            {block.signers.map((s, i) => (
                <div key={i} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2">
                    <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                        <span className="imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                            {__('Firma')} {i + 1}
                        </span>
                        {block.signers.length > 1 && <IconBtn label={__('Quitar')} icon={X} danger onClick={() => set(block.signers.filter((_, k) => k !== i))} />}
                    </div>
                    <Field label={__('Nombre')}>{tagInput(p, s.name, (v) => set(block.signers.map((x, k) => (k === i ? { ...x, name: v } : x))))}</Field>
                    <Field label={__('Debajo del nombre')}>
                        {tagInput(p, s.detail, (v) => set(block.signers.map((x, k) => (k === i ? { ...x, detail: v } : x))), { placeholder: 'C.C. 1.234.567' })}
                    </Field>
                </div>
            ))}
            {block.signers.length < 3 && (
                <Button type="button" variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => set([...block.signers, { name: '', detail: '' }])}>
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Agregar otra firma')}
                </Button>
            )}
            <DocImageField label={__('Firma escaneada (opcional)')} value={block.image} onChange={(image) => p.onPatch({ image })} />
        </>
    );
}
