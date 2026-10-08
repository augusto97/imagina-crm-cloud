import { useRef, useState } from 'react';
import {
    AlignCenter,
    AlignLeft,
    AlignRight,
    ArrowDown,
    ArrowUp,
    Copy,
    ImagePlus,
    Loader2,
    Plus,
    Trash2,
} from 'lucide-react';
import {
    COLUMN_RATIOS,
    EMAIL_FIELDS_BLOCK_TYPES,
    type BlockStyle,
    type BorderStyle,
    type EmailAlign,
    type EmailBlock,
    type EmailDesign,
    type EmailInnerBlock,
    type EmailInnerBlockType,
    type EmailPadding,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { api } from '@/cloud/session';
import { api as restApi } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import {
    BlockStylePanel,
    ButtonStylePanel,
    Choice,
    ColorField,
    ImageFramePanel,
    NumberField,
    StyleSection,
} from '@/components/design/DesignStyleControls';

import { ColorRow } from '../../template-editor-core/BlockStyleEditor';
import { MergeTagInput } from '../MergeTagInput';
import { EMAIL_BLOCK_LABELS, INNER_BLOCK_TYPES, makeInner } from './emailDesignOps';
import { EmailTextEditor } from './EmailTextEditor';

/**
 * v0.1.265 — Panel de ajustes del bloque elegido en el editor de correos
 * (ADR-S34). Cada control escribe sobre el MISMO modelo que renderiza la
 * vista previa: el cambio se ve en el acto.
 */
export interface InspectorProps {
    block: EmailBlock | EmailInnerBlock;
    inColumn: boolean;
    /** v0.1.270 — en el borde de su lista no se puede subir/bajar más. */
    canMoveUp?: boolean;
    canMoveDown?: boolean;
    design: EmailDesign;
    fields: FieldEntity[];
    onPatch: (patch: Record<string, unknown>) => void;
    onMove: (delta: -1 | 1) => void;
    onDuplicate: () => void;
    onRemove: () => void;
    onSelect: (id: string) => void;
    onAppendToColumn: (columnIndex: number, block: EmailInnerBlock) => void;
    onSetColumns: (count: 2 | 3) => void;
    signatureHint: string;
}

export function EmailBlockInspector(p: InspectorProps): JSX.Element {
    const { block } = p;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="email-inspector">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <div>
                    <p className="imcrm-text-[11px] imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {p.inColumn ? __('Bloque en columna') : __('Bloque')}
                    </p>
                    <h3 className="imcrm-text-sm imcrm-font-semibold">{__(EMAIL_BLOCK_LABELS[block.type])}</h3>
                </div>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-0.5">
                    <IconBtn label={__('Subir (Alt+↑)')} onClick={() => p.onMove(-1)} icon={ArrowUp} disabled={p.canMoveUp === false} />
                    <IconBtn label={__('Bajar (Alt+↓)')} onClick={() => p.onMove(1)} icon={ArrowDown} disabled={p.canMoveDown === false} />
                    <IconBtn label={__('Duplicar (Ctrl+D)')} onClick={p.onDuplicate} icon={Copy} />
                    <IconBtn label={__('Eliminar (Supr)')} onClick={p.onRemove} icon={Trash2} danger />
                </div>
            </div>

            <BlockFields {...p} />

            {block.type !== 'spacer' && (
                <Section title={__('Fondo y espacio')}>
                    <ColorRow
                        label={block.style?.bg_mode === 'box' ? __('Color de fondo') : __('Banda de color')}
                        value={block.background ?? undefined}
                        onChange={(v) => p.onPatch({ background: v ?? null })}
                    />
                    <Segmented<EmailPadding>
                        label={__('Espacio arriba y abajo')}
                        value={block.padding ?? (block.background ? 'lg' : 'sm')}
                        options={[
                            { value: 'none', label: __('Nada') },
                            { value: 'sm', label: __('Poco') },
                            { value: 'md', label: __('Medio') },
                            { value: 'lg', label: __('Mucho') },
                        ]}
                        onChange={(v) => p.onPatch({ padding: v })}
                    />
                </Section>
            )}

            {block.type === 'button' && (
                <ButtonStylePanel
                    value={block.btn}
                    onChange={(btn) => p.onPatch({ btn })}
                    fullWidth={block.full_width}
                    defaultRadius={p.design.theme.radius}
                />
            )}
            {block.type === 'image' && (
                <ImageFramePanel
                    medium="email"
                    value={block.frame}
                    onChange={(frame) => p.onPatch({ frame })}
                    defaultRadius={block.bleed ? 0 : Math.min(p.design.theme.radius, 8)}
                />
            )}

            {block.type !== 'spacer' && (
                <BlockStylePanel
                    medium="email"
                    value={block.style}
                    onChange={(style) => p.onPatch({ style })}
                    typography={TYPO_BLOCKS.has(block.type)}
                    box
                    hasBackground={!!block.background}
                    defaults={styleDefaults(block, p.design)}
                    inheritFontLabel={block.type === 'heading' ? __('La de los títulos') : __('La del estilo general')}
                />
            )}
        </div>
    );
}

/** Bloques con texto propio: muestran la sección Tipografía. */
const TYPO_BLOCKS = new Set<string>(['heading', 'text', 'button', 'fields', 'signature']);

const HEADING_SIZES: Record<1 | 2 | 3, number> = { 1: 28, 2: 22, 3: 18 };

/** Lo que el renderizador usa si el campo queda vacío (para las pistas). */
function styleDefaults(block: EmailBlock | EmailInnerBlock, design: EmailDesign): { size?: number; lineHeight?: number; padding?: number } {
    const base = design.theme.font_size ?? 15;
    const lh = design.theme.line_height ?? 1.6;
    switch (block.type) {
        case 'heading':
            return { size: HEADING_SIZES[block.level], lineHeight: 1.25 };
        case 'text':
            return { size: { sm: base - 2, md: base, lg: base + 2 }[block.size], lineHeight: lh };
        case 'button':
            return { size: 15, lineHeight: 1.33 };
        case 'fields':
            return { size: 15, lineHeight: 1.4 };
        case 'signature':
            return { size: 14, lineHeight: 1.5 };
        default:
            return {};
    }
}

function BlockFields(p: InspectorProps): JSX.Element | null {
    const { block, fields, onPatch } = p;
    switch (block.type) {
        case 'heading':
            return (
                <>
                    <Field label={__('Texto')}>
                        <MergeTagInput value={block.text} onChange={(v) => onPatch({ text: v })} fields={fields} />
                    </Field>
                    <Segmented<string>
                        label={__('Tamaño')}
                        value={String(block.level)}
                        options={[
                            { value: '1', label: __('Grande') },
                            { value: '2', label: __('Mediano') },
                            { value: '3', label: __('Chico') },
                        ]}
                        onChange={(v) => onPatch({ level: Number(v) })}
                    />
                    <AlignControl value={block.align} onChange={(v) => onPatch({ align: v })} />
                    <ColorRow label={__('Color del texto')} value={block.color ?? undefined} onChange={(v) => onPatch({ color: v ?? null })} />
                </>
            );
        case 'text':
            return (
                <>
                    <EmailTextEditor key={block.id} value={block.doc} onChange={(doc) => onPatch({ doc })} fields={fields} />
                    <Segmented<'sm' | 'md' | 'lg'>
                        label={__('Tamaño de letra')}
                        value={block.size}
                        options={[
                            { value: 'sm', label: __('Chica') },
                            { value: 'md', label: __('Normal') },
                            { value: 'lg', label: __('Grande') },
                        ]}
                        onChange={(v) => onPatch({ size: v })}
                    />
                    <AlignControl value={block.align} onChange={(v) => onPatch({ align: v })} />
                    <ColorRow label={__('Color del texto')} value={block.color ?? undefined} onChange={(v) => onPatch({ color: v ?? null })} />
                    <NumberField
                        label={__('Espacio entre párrafos')}
                        unit="px"
                        min={0}
                        max={48}
                        value={block.paragraph_spacing}
                        onChange={(v) => onPatch({ paragraph_spacing: v })}
                        placeholder={String(Math.round((p.design.theme.font_size ?? 15) * 0.8))}
                    />
                </>
            );
        case 'button':
            return (
                <>
                    <Field label={__('Texto del botón')}>
                        <MergeTagInput value={block.label} onChange={(v) => onPatch({ label: v })} fields={fields} />
                    </Field>
                    <Field label={__('Enlace')} hint={__('https://…, mailto:… o una variable como {{pago.link}}')}>
                        <MergeTagInput value={block.url} onChange={(v) => onPatch({ url: v })} fields={fields} placeholder="https://" />
                    </Field>
                    <AlignControl value={block.align} onChange={(v) => onPatch({ align: v })} />
                    <Check label={__('Ocupar todo el ancho')} checked={block.full_width} onChange={(v) => onPatch({ full_width: v })} />
                    <ColorRow label={__('Color del botón')} value={block.color ?? undefined} onChange={(v) => onPatch({ color: v ?? null })} />
                    <ColorRow label={__('Color del texto')} value={block.text_color ?? undefined} onChange={(v) => onPatch({ text_color: v ?? null })} />
                </>
            );
        case 'image':
            return <ImageFields {...p} />;
        case 'divider':
            return (
                <>
                    <ColorRow label={__('Color de la línea')} value={block.color ?? undefined} onChange={(v) => onPatch({ color: v ?? null })} />
                    <Segmented<string>
                        label={__('Grosor')}
                        value={String(block.thickness)}
                        options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n}px` }))}
                        onChange={(v) => onPatch({ thickness: Number(v) })}
                    />
                    <Choice<BorderStyle>
                        label={__('Tipo de línea')}
                        value={block.line_style ?? 'solid'}
                        options={[
                            { value: 'solid', label: __('Continua') },
                            { value: 'dashed', label: __('Rayada') },
                            { value: 'dotted', label: __('Punteada') },
                        ]}
                        onChange={(v) => onPatch({ line_style: v === 'solid' ? undefined : v })}
                    />
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
                </>
            );
        case 'spacer':
            return (
                <Field label={sprintfHeight(block.height)}>
                    <input
                        type="range"
                        min={4}
                        max={120}
                        step={4}
                        value={block.height}
                        onChange={(e) => onPatch({ height: Number(e.target.value) })}
                        className="imcrm-w-full"
                        aria-label={__('Alto del espacio')}
                    />
                </Field>
            );
        case 'fields':
            return <FieldsFields {...p} />;
        case 'signature':
            return (
                <p className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-3 imcrm-text-xs imcrm-leading-relaxed imcrm-text-muted-foreground">
                    {p.signatureHint}
                </p>
            );
        case 'html':
            return (
                <Field
                    label={__('Tu HTML')}
                    hint={__('Para expertos: se envía tal cual (con estilos inline para que Outlook lo respete). Las variables {{campo}} se reemplazan con el valor escapado.')}
                >
                    <Textarea
                        rows={10}
                        value={block.html}
                        onChange={(e) => onPatch({ html: e.target.value })}
                        className="imcrm-font-mono imcrm-text-xs"
                        placeholder="<p style=&quot;margin:0&quot;>Hola {{nombre}}</p>"
                    />
                </Field>
            );
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
                    <Choice<string>
                        label={__('Proporción')}
                        value={block.ratio && block.ratio.split('-').length === block.columns.length ? block.ratio : block.columns.length === 2 ? '1-1' : '1-1-1'}
                        options={COLUMN_RATIOS[block.columns.length as 2 | 3].map((r) => ({ value: r, label: ratioLabel(r) }))}
                        onChange={(v) => onPatch({ ratio: v === '1-1' || v === '1-1-1' ? undefined : v })}
                    />
                    <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                        <NumberField label={__('Separación')} unit="px" min={0} max={64} value={block.gap} onChange={(v) => onPatch({ gap: v ?? undefined })} placeholder="16" />
                        <Choice<'top' | 'middle' | 'bottom'>
                            label={__('Alinear')}
                            value={block.valign ?? 'top'}
                            options={[
                                { value: 'top', label: __('Arriba') },
                                { value: 'middle', label: __('Centro') },
                                { value: 'bottom', label: __('Abajo') },
                            ]}
                            onChange={(v) => onPatch({ valign: v === 'top' ? undefined : v })}
                        />
                    </div>
                    <Check
                        label={__('En el celular, una debajo de la otra')}
                        checked={block.stack !== false}
                        onChange={(v) => onPatch({ stack: v ? undefined : false })}
                    />
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                        {block.stack === false
                            ? __('Quedan lado a lado también en el teléfono: usalo sólo con contenido corto (íconos, cifras).')
                            : __('En el celular las columnas se apilan solas. Tocá un bloque de una columna en la vista previa para editarlo.')}
                    </p>
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
                                        {__(EMAIL_BLOCK_LABELS[ib.type])}
                                        <span className="imcrm-text-muted-foreground">{__('Editar')}</span>
                                    </button>
                                ))}
                                <AddInner onAdd={(t) => p.onAppendToColumn(ci, makeInner(t))} />
                            </div>
                            <ColumnBoxEditor
                                background={col.background ?? null}
                                style={col.style}
                                onChange={(patch) =>
                                    onPatch({ columns: block.columns.map((c, i) => (i === ci ? { ...c, ...patch } : c)) })
                                }
                            />
                        </div>
                    ))}
                </>
            );
        default:
            return null;
    }
}

/** «1-2» → «1 : 2». */
function ratioLabel(r: string): string {
    return r.split('-').join(' : ');
}

/** Fondo y recuadro de UNA columna (plegado). */
function ColumnBoxEditor({
    background,
    style,
    onChange,
}: {
    background: string | null;
    style: BlockStyle | undefined;
    onChange: (patch: { background?: string | null; style?: BlockStyle }) => void;
}): JSX.Element {
    return (
        <StyleSection title={__('Fondo y recuadro')} modified={!!background || !!style}>
            <ColorField label={__('Color de fondo')} value={background} onChange={(v) => onChange({ background: v })} />
            <BlockStylePanel medium="email" value={style} onChange={(st) => onChange({ style: st })} box />
        </StyleSection>
    );
}

function sprintfHeight(h: number): string {
    return `${__('Alto')}: ${h}px`;
}

function AddInner({ onAdd }: { onAdd: (type: EmailInnerBlockType) => void }): JSX.Element {
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
            {INNER_BLOCK_TYPES.map((t) => (
                <button
                    key={t}
                    type="button"
                    onClick={() => {
                        onAdd(t);
                        setOpen(false);
                    }}
                    className="imcrm-rounded imcrm-border imcrm-border-border imcrm-px-2 imcrm-py-0.5 imcrm-text-[11px] hover:imcrm-bg-accent"
                >
                    {__(EMAIL_BLOCK_LABELS[t])}
                </button>
            ))}
        </div>
    );
}

function ImageFields(p: InspectorProps): JSX.Element {
    const block = p.block as Extract<EmailBlock, { type: 'image' }>;
    const toast = useToast();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [uploading, setUploading] = useState(false);

    const upload = async (file: File): Promise<void> => {
        setUploading(true);
        try {
            const { id } = await api.uploadFile(file);
            // Una URL pública de larga vida: el correo se lee años después.
            const res = await restApi.post<{ url: string }>(`/files/${id}/public-url`, {});
            p.onPatch({ src: res.data.url, alt: block.alt || file.name.replace(/\.[^.]+$/, '') });
            toast.success(__('Imagen subida'));
        } catch (err) {
            toast.error(__('No se pudo subir la imagen'), err instanceof Error ? err.message : String(err));
        } finally {
            setUploading(false);
        }
    };

    return (
        <>
            <Field label={__('Imagen')} hint={__('PNG, JPG, GIF o WebP. Se recomienda menos de 1 MB.')}>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <input
                        ref={inputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/gif,image/webp"
                        className="imcrm-hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void upload(f);
                            e.target.value = '';
                        }}
                    />
                    <Button type="button" variant="outline" size="sm" className="imcrm-gap-1.5" disabled={uploading} onClick={() => inputRef.current?.click()}>
                        {uploading ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <ImagePlus className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {__('Subir imagen')}
                    </Button>
                    <MergeTagInput value={block.src} onChange={(v) => p.onPatch({ src: v })} fields={p.fields} placeholder={__('o pegá la dirección https://…')} />
                </div>
            </Field>
            <Field label={__('Texto alternativo')} hint={__('Lo que se lee si el programa de correo no muestra imágenes.')}>
                <Input value={block.alt} onChange={(e) => p.onPatch({ alt: e.target.value })} />
            </Field>
            <Field label={`${__('Ancho')}: ${block.width}%`}>
                <input
                    type="range"
                    min={10}
                    max={100}
                    step={5}
                    value={block.width}
                    onChange={(e) => p.onPatch({ width: Number(e.target.value) })}
                    className="imcrm-w-full"
                    aria-label={__('Ancho de la imagen')}
                />
            </Field>
            <AlignControl value={block.align} onChange={(v) => p.onPatch({ align: v })} />
            <Field label={__('Enlace al hacer clic (opcional)')}>
                <MergeTagInput value={block.link} onChange={(v) => p.onPatch({ link: v })} fields={p.fields} placeholder="https://" />
            </Field>
            {!p.inColumn && (
                <Check label={__('De borde a borde (sin márgenes)')} checked={block.bleed} onChange={(v) => p.onPatch({ bleed: v })} />
            )}
        </>
    );
}

function FieldsFields(p: InspectorProps): JSX.Element {
    const block = p.block as Extract<EmailBlock, { type: 'fields' }>;
    const usable = p.fields.filter((f) => EMAIL_FIELDS_BLOCK_TYPES.includes(f.type));
    const toggle = (slug: string): void => {
        const has = block.slugs.includes(slug);
        p.onPatch({ slugs: has ? block.slugs.filter((s) => s !== slug) : [...block.slugs, slug] });
    };
    return (
        <>
            <Field label={__('Título (opcional)')}>
                <MergeTagInput value={block.title} onChange={(v) => p.onPatch({ title: v })} fields={p.fields} />
            </Field>
            <Field label={__('Campos a mostrar')} hint={__('Se muestran con su nombre y el valor como se ve en la ficha (montos, fechas y opciones legibles).')}>
                <div className="imcrm-flex imcrm-max-h-56 imcrm-flex-col imcrm-gap-0.5 imcrm-overflow-y-auto imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-1">
                    {usable.length === 0 && <p className="imcrm-p-2 imcrm-text-xs imcrm-text-muted-foreground">{__('La lista no tiene campos para mostrar.')}</p>}
                    {usable.map((f) => {
                        const idx = block.slugs.indexOf(f.slug);
                        return (
                            <label key={f.id} className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-2 imcrm-py-1 imcrm-text-xs hover:imcrm-bg-accent">
                                <input type="checkbox" checked={idx >= 0} onChange={() => toggle(f.slug)} />
                                <span className="imcrm-flex-1 imcrm-truncate">{f.label}</span>
                                {idx >= 0 && <span className="imcrm-text-[10px] imcrm-text-muted-foreground">#{idx + 1}</span>}
                            </label>
                        );
                    })}
                </div>
            </Field>
            <Segmented<'table' | 'stacked'>
                label={__('Forma')}
                value={block.layout}
                options={[
                    { value: 'table', label: __('Tabla') },
                    { value: 'stacked', label: __('Uno debajo del otro') },
                ]}
                onChange={(v) => p.onPatch({ layout: v })}
            />
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <ColorField label={__('Color de los nombres')} value={block.label_color} onChange={(v) => p.onPatch({ label_color: v })} placeholder={p.design.theme.muted} />
                <ColorField label={__('Color de los valores')} value={block.value_color} onChange={(v) => p.onPatch({ value_color: v })} placeholder={p.design.theme.text} />
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
                            onChange={(e) => p.onPatch({ label_width: Number(e.target.value) })}
                            className="imcrm-w-full"
                            aria-label={__('Ancho de la columna de nombres')}
                        />
                    </Field>
                    <Check label={__('Línea entre filas')} checked={block.lines !== false} onChange={(v) => p.onPatch({ lines: v ? undefined : false })} />
                </>
            )}
        </>
    );
}

// --- piezas chicas -----------------------------------------------------------

export function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-3">
            <p className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{title}</p>
            {children}
        </div>
    );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label className="imcrm-text-xs">{label}</Label>
            {children}
            {hint && <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">{hint}</p>}
        </div>
    );
}

export function Segmented<T extends string>({
    label,
    value,
    options,
    onChange,
}: {
    label: string;
    value: T;
    options: Array<{ value: T; label: string; icon?: typeof AlignLeft }>;
    onChange: (v: T) => void;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <span className="imcrm-text-xs imcrm-font-medium">{label}</span>
            <div role="group" aria-label={label} className="imcrm-flex imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-p-0.5">
                {options.map((o) => {
                    const Icon = o.icon;
                    return (
                        <button
                            key={o.value}
                            type="button"
                            aria-pressed={o.value === value}
                            title={o.label}
                            onClick={() => onChange(o.value)}
                            className={cn(
                                'imcrm-flex imcrm-h-7 imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-gap-1 imcrm-rounded imcrm-px-1.5 imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground',
                                o.value === value && 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm',
                            )}
                        >
                            {Icon ? <Icon className="imcrm-h-3.5 imcrm-w-3.5" aria-label={o.label} /> : o.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export function AlignControl({ value, onChange }: { value: EmailAlign; onChange: (v: EmailAlign) => void }): JSX.Element {
    return (
        <Segmented<EmailAlign>
            label={__('Alineación')}
            value={value}
            options={[
                { value: 'left', label: __('Izquierda'), icon: AlignLeft },
                { value: 'center', label: __('Centro'), icon: AlignCenter },
                { value: 'right', label: __('Derecha'), icon: AlignRight },
            ]}
            onChange={onChange}
        />
    );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }): JSX.Element {
    return (
        <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2 imcrm-text-xs">
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
            {label}
        </label>
    );
}

export function IconBtn({
    label,
    onClick,
    icon: Icon,
    danger,
    disabled,
}: {
    label: string;
    onClick: () => void;
    icon: typeof Copy;
    danger?: boolean;
    disabled?: boolean;
}): JSX.Element {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            onClick={onClick}
            disabled={disabled}
            className={cn(
                'imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground disabled:imcrm-pointer-events-none disabled:imcrm-opacity-35',
                danger && 'hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive',
            )}
        >
            <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
        </button>
    );
}

export { INNER_BLOCK_TYPES };
