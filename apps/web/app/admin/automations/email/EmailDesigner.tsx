import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
    Braces,
    Code2,
    Columns2,
    Database,
    Heading1,
    Image as ImageIcon,
    LayoutTemplate,
    Loader2,
    Minus,
    Monitor,
    MousePointerClick,
    MoveVertical,
    PenLine,
    Redo2,
    Smartphone,
    Type,
    Undo2,
    X,
} from 'lucide-react';
import {
    EMAIL_FONT_LABELS,
    EMAIL_FONTS,
    EMAIL_TEMPLATES,
    emailTemplateDesign,
    renderEmailHtml,
    type EmailBlockType,
    type EmailDesign,
    type EmailFont,
    type EmailTestResult,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { api } from '@/lib/api';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { ColorRow } from '../../template-editor-core/BlockStyleEditor';
import { EmailBlockInspector, Field, Section, Segmented } from './EmailBlockInspector';
import {
    EMAIL_BLOCK_HINTS,
    EMAIL_BLOCK_LABELS,
    appendToColumn,
    duplicateBlock,
    findBlock,
    insertBlock,
    locate,
    makeBlock,
    moveBlock,
    removeBlock,
    setColumnCount,
    updateBlock,
} from './emailDesignOps';
import { EmailPreviewFrame, EmailThumbnail } from './EmailPreviewFrame';

/**
 * v0.1.265 — Editor de correos a pantalla completa (ADR-S34).
 *
 * Izquierda: los bloques para agregar y el estilo general (colores,
 * tipografía, ancho). Centro: el correo REAL (el mismo HTML que sale por
 * Gmail/Outlook), en escritorio o celular, con las variables como pastillas
 * o resueltas contra un registro de la lista. Derecha: los ajustes del bloque
 * elegido. Deshacer/rehacer con Ctrl+Z / Ctrl+Shift+Z.
 */

const PALETTE: Array<{ type: EmailBlockType; icon: typeof Type }> = [
    { type: 'heading', icon: Heading1 },
    { type: 'text', icon: Type },
    { type: 'button', icon: MousePointerClick },
    { type: 'image', icon: ImageIcon },
    { type: 'fields', icon: Database },
    { type: 'columns', icon: Columns2 },
    { type: 'divider', icon: Minus },
    { type: 'spacer', icon: MoveVertical },
    { type: 'signature', icon: PenLine },
    { type: 'html', icon: Code2 },
];

interface History {
    past: EmailDesign[];
    present: EmailDesign;
    future: EmailDesign[];
    /** Clave del último cambio: tipeos seguidos del mismo control = un paso. */
    lastKey: string | null;
    lastAt: number;
}

export interface EmailDesignerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    value: EmailDesign;
    onApply: (design: EmailDesign) => void;
    fields: FieldEntity[];
    /** `config` actual de la acción (para la vista con datos reales). */
    actionConfig: Record<string, unknown>;
    listId: number | undefined;
    subject: string;
    preheader: string;
    signatureHtml: string | null;
    signatureHint: string;
    /** Color de la marca de la empresa (las plantillas lo adoptan). */
    brandAccent: string | null;
    /** Abrir directo en la galería de plantillas (diseño nuevo). */
    startWithTemplates?: boolean;
}

export default function EmailDesigner(props: EmailDesignerProps): JSX.Element {
    return (
        <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40" />
                <Dialog.Content
                    aria-describedby={undefined}
                    className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-flex imcrm-flex-col imcrm-bg-background imcrm-text-foreground focus:imcrm-outline-none"
                    onEscapeKeyDown={(e) => e.preventDefault()}
                >
                    {props.open && <DesignerBody {...props} />}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function DesignerBody(props: EmailDesignerProps): JSX.Element {
    const toast = useToast();
    const narrow = useMediaQuery('(max-width: 1023px)');
    const [hist, setHist] = useState<History>({ past: [], present: props.value, future: [], lastKey: null, lastAt: 0 });
    const design = hist.present;
    const [selected, setSelected] = useState<string | null>(null);
    const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
    const [dataMode, setDataMode] = useState<'tags' | 'real'>('tags');
    const [leftTab, setLeftTab] = useState<'blocks' | 'style'>('blocks');
    const [mobileTab, setMobileTab] = useState<'add' | 'preview' | 'edit'>('preview');
    const [showTemplates, setShowTemplates] = useState(Boolean(props.startWithTemplates));
    const confirm = useConfirm();
    const dirty = hist.past.length > 0;

    const commit = useCallback((next: EmailDesign | ((d: EmailDesign) => EmailDesign), key: string | null = null) => {
        setHist((h) => {
            const value = typeof next === 'function' ? next(h.present) : next;
            if (value === h.present) return h;
            const now = Date.now();
            const coalesce = key !== null && key === h.lastKey && now - h.lastAt < 900;
            return {
                past: coalesce ? h.past : [...h.past, h.present].slice(-80),
                present: value,
                future: [],
                lastKey: key,
                lastAt: now,
            };
        });
    }, []);
    const undo = useCallback(() => {
        setHist((h) =>
            h.past.length === 0
                ? h
                : { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future], lastKey: null, lastAt: 0 },
        );
    }, []);
    const redo = useCallback(() => {
        setHist((h) =>
            h.future.length === 0
                ? h
                : { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1), lastKey: null, lastAt: 0 },
        );
    }, []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent): void => {
            const target = e.target as HTMLElement | null;
            const typing = target?.closest('input, textarea, [contenteditable="true"]');
            if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z' || typing) return;
            e.preventDefault();
            if (e.shiftKey) redo();
            else undo();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [undo, redo]);

    // La selección se limpia si el bloque desaparece (deshacer, borrar).
    useEffect(() => {
        if (selected && !findBlock(design, selected)) setSelected(null);
    }, [design, selected]);

    const fieldLabel = useCallback(
        (slug: string) => props.fields.find((f) => f.slug === slug)?.label ?? null,
        [props.fields],
    );

    const previewHtml = useMemo(
        () =>
            renderEmailHtml(design, {
                resolve: (t) => t,
                preview: true,
                selectedId: selected,
                fieldLabel,
                signatureHtml: props.signatureHtml,
                appendSignature: Boolean(props.signatureHtml),
                subject: props.subject,
                preheader: props.preheader,
            }),
        [design, selected, fieldLabel, props.signatureHtml, props.subject, props.preheader],
    );

    // Vista con datos de un registro real: el servidor arma el correo con el
    // MISMO compositor del envío.
    const [real, setReal] = useState<EmailTestResult | null>(null);
    const [realLoading, setRealLoading] = useState(false);
    const designRef = useRef(design);
    designRef.current = design;
    useEffect(() => {
        if (dataMode !== 'real') return;
        let alive = true;
        setRealLoading(true);
        const timer = window.setTimeout(() => {
            api.post<EmailTestResult>(`/lists/${props.listId ?? 0}/automations/test-email`, {
                config: { ...props.actionConfig, body_mode: 'design', design: designRef.current },
                send: false,
            })
                .then((res) => alive && setReal(res.data))
                .catch((err: unknown) =>
                    alive &&
                    setReal({
                        subject: '',
                        html: null,
                        text: null,
                        sample_record_id: null,
                        sent_to: null,
                        error: err instanceof Error ? err.message : String(err),
                        signature_note: null,
                    }),
                )
                .finally(() => alive && setRealLoading(false));
        }, 350);
        return () => {
            alive = false;
            window.clearTimeout(timer);
        };
    }, [dataMode, design, props.listId, props.actionConfig]);

    const selectedBlock = findBlock(design, selected);
    const selectedLoc = selected ? locate(design, selected) : null;

    const add = (type: EmailBlockType): void => {
        const block = makeBlock(type);
        commit((d) => insertBlock(d, block, selected));
        setSelected(block.id);
        if (narrow) setMobileTab('edit');
    };

    const onSelect = (id: string | null): void => {
        setSelected(id);
        if (id && narrow) setMobileTab('edit');
    };

    const close = (): void => {
        if (!dirty) {
            props.onOpenChange(false);
            return;
        }
        void confirm({
            title: __('¿Descartar los cambios del diseño?'),
            description: __('Los cambios que hiciste en el editor no se van a aplicar.'),
            confirmLabel: __('Descartar'),
            destructive: true,
        }).then((ok) => ok && props.onOpenChange(false));
    };

    const apply = (): void => {
        props.onApply(design);
        props.onOpenChange(false);
        toast.success(__('Diseño aplicado'), __('Acordate de guardar la automatización.'));
    };

    const left = (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col">
            <div className="imcrm-flex imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-p-2">
                <TabBtn active={leftTab === 'blocks'} onClick={() => setLeftTab('blocks')}>
                    {__('Bloques')}
                </TabBtn>
                <TabBtn active={leftTab === 'style'} onClick={() => setLeftTab('style')}>
                    {__('Estilo general')}
                </TabBtn>
            </div>
            <div className="imcrm-flex-1 imcrm-overflow-y-auto imcrm-p-3">
                {leftTab === 'blocks' ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            {selected
                                ? __('Se agrega debajo del bloque elegido.')
                                : __('Tocá un bloque para agregarlo al final del correo.')}
                        </p>
                        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2" data-testid="email-palette">
                            {PALETTE.map(({ type, icon: Icon }) => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => add(type)}
                                    title={__(EMAIL_BLOCK_HINTS[type])}
                                    data-block-type={type}
                                    className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-1 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2.5 imcrm-text-left hover:imcrm-border-primary/50 hover:imcrm-bg-primary/5"
                                >
                                    <Icon className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" />
                                    <span className="imcrm-text-xs imcrm-font-medium">{__(EMAIL_BLOCK_LABELS[type])}</span>
                                    <span className="imcrm-line-clamp-2 imcrm-text-[10.5px] imcrm-leading-snug imcrm-text-muted-foreground">
                                        {__(EMAIL_BLOCK_HINTS[type])}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <Outline design={design} selected={selected} onSelect={onSelect} />
                    </div>
                ) : (
                    <ThemePanel design={design} onChange={(theme, key) => commit((d) => ({ ...d, theme: { ...d.theme, ...theme } }), key)} />
                )}
            </div>
        </div>
    );

    const inspector = selectedBlock ? (
        <EmailBlockInspector
            key={selectedBlock.id}
            block={selectedBlock}
            inColumn={selectedLoc?.parentId !== null && selectedLoc?.parentId !== undefined}
            design={design}
            fields={props.fields}
            signatureHint={props.signatureHint}
            onPatch={(patch) => commit((d) => updateBlock(d, selectedBlock.id, patch), `${selectedBlock.id}:${Object.keys(patch).join(',')}`)}
            onMove={(delta) => commit((d) => moveBlock(d, selectedBlock.id, delta))}
            onDuplicate={() => {
                const r = duplicateBlock(design, selectedBlock.id);
                commit(r.design);
                if (r.newId) setSelected(r.newId);
            }}
            onRemove={() => {
                commit((d) => removeBlock(d, selectedBlock.id));
                setSelected(null);
            }}
            onSelect={onSelect}
            onAppendToColumn={(ci, block) => {
                commit((d) => appendToColumn(d, selectedBlock.id, ci, block));
                setSelected(block.id);
            }}
            onSetColumns={(n) => commit((d) => setColumnCount(d, selectedBlock.id, n))}
        />
    ) : (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-p-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
            <MousePointerClick className="imcrm-h-6 imcrm-w-6" />
            {__('Tocá un bloque en la vista previa para editarlo.')}
        </div>
    );

    const realBanner =
        dataMode === 'real' ? (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-bg-amber-50 imcrm-px-3 imcrm-py-1.5 imcrm-text-[11px] imcrm-text-amber-900 dark:imcrm-bg-amber-950/40 dark:imcrm-text-amber-200">
                {realLoading && <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />}
                {real?.error
                    ? real.error
                    : real?.sample_record_id
                      ? `${__('Con los datos del registro')} #${real.sample_record_id}. ${real.signature_note ?? ''}`
                      : __('La lista no tiene registros: las variables quedan vacías.')}
            </div>
        ) : null;

    const preview = (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-bg-canvas">
            {realBanner}
            <div className="imcrm-flex imcrm-flex-1 imcrm-justify-center imcrm-overflow-hidden imcrm-p-3">
                <div
                    className={cn(
                        'imcrm-h-full imcrm-overflow-hidden imcrm-bg-white imcrm-shadow-imcrm-md',
                        device === 'mobile' ? 'imcrm-rounded-[22px] imcrm-border-[6px] imcrm-border-neutral-800' : 'imcrm-w-full imcrm-rounded-md',
                    )}
                    style={device === 'mobile' ? { width: 375 } : undefined}
                >
                    <EmailPreviewFrame
                        html={dataMode === 'real' ? real?.html ?? '' : previewHtml}
                        onSelect={onSelect}
                        interactive={dataMode === 'tags'}
                    />
                </div>
            </div>
        </div>
    );

    return (
        <>
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-3 imcrm-py-2">
                <Dialog.Title className="imcrm-mr-auto imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                    {__('Diseñar correo')}
                    {props.subject && (
                        <span className="imcrm-hidden imcrm-max-w-[280px] imcrm-truncate imcrm-font-normal imcrm-text-muted-foreground sm:imcrm-inline">
                            · {props.subject}
                        </span>
                    )}
                </Dialog.Title>
                <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => setShowTemplates(true)}>
                    <LayoutTemplate className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Plantillas')}
                </Button>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-0.5">
                    <IconToggle label={__('Deshacer (Ctrl+Z)')} onClick={undo} disabled={hist.past.length === 0} icon={Undo2} />
                    <IconToggle label={__('Rehacer (Ctrl+Shift+Z)')} onClick={redo} disabled={hist.future.length === 0} icon={Redo2} />
                </div>
                <div role="group" aria-label={__('Dispositivo')} className="imcrm-flex imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-0.5">
                    <IconToggle label={__('Escritorio')} active={device === 'desktop'} onClick={() => setDevice('desktop')} icon={Monitor} />
                    <IconToggle label={__('Celular')} active={device === 'mobile'} onClick={() => setDevice('mobile')} icon={Smartphone} />
                </div>
                <div role="group" aria-label={__('Datos de la vista previa')} className="imcrm-flex imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-0.5">
                    <IconToggle label={__('Ver las variables')} active={dataMode === 'tags'} onClick={() => setDataMode('tags')} icon={Braces} />
                    <IconToggle label={__('Ver con datos de un registro')} active={dataMode === 'real'} onClick={() => setDataMode('real')} icon={Database} />
                </div>
                <Button variant="ghost" size="sm" onClick={close}>
                    {__('Cancelar')}
                </Button>
                <Button size="sm" onClick={apply} data-testid="email-designer-apply">
                    {__('Listo')}
                </Button>
                <button type="button" onClick={close} aria-label={__('Cerrar')} className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded hover:imcrm-bg-accent">
                    <X className="imcrm-h-4 imcrm-w-4" />
                </button>
            </header>

            {narrow ? (
                <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-flex-col">
                    <div className="imcrm-flex imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-p-1.5">
                        <TabBtn active={mobileTab === 'add'} onClick={() => setMobileTab('add')}>
                            {__('Bloques')}
                        </TabBtn>
                        <TabBtn active={mobileTab === 'preview'} onClick={() => setMobileTab('preview')}>
                            {__('Vista previa')}
                        </TabBtn>
                        <TabBtn active={mobileTab === 'edit'} onClick={() => setMobileTab('edit')}>
                            {__('Editar')}
                        </TabBtn>
                    </div>
                    <div className="imcrm-min-h-0 imcrm-flex-1">
                        {mobileTab === 'add' && left}
                        {mobileTab === 'preview' && preview}
                        {mobileTab === 'edit' && <div className="imcrm-h-full imcrm-overflow-y-auto imcrm-p-3">{inspector}</div>}
                    </div>
                </div>
            ) : (
                <div className="imcrm-grid imcrm-min-h-0 imcrm-flex-1 imcrm-grid-cols-[280px_minmax(0,1fr)_340px]">
                    <aside className="imcrm-min-h-0 imcrm-border-r imcrm-border-border">{left}</aside>
                    <main className="imcrm-min-h-0">{preview}</main>
                    <aside className="imcrm-min-h-0 imcrm-overflow-y-auto imcrm-border-l imcrm-border-border imcrm-p-4">{inspector}</aside>
                </div>
            )}

            {showTemplates && (
                <TemplatesGallery
                    accent={props.brandAccent}
                    onClose={() => setShowTemplates(false)}
                    onPick={(key) => {
                        commit(emailTemplateDesign(key, props.brandAccent));
                        setSelected(null);
                        setShowTemplates(false);
                        if (dirty || design.blocks.length > 0) toast.info(__('Plantilla aplicada'), __('Podés volver atrás con Deshacer.'));
                    }}
                />
            )}

        </>
    );
}

function Outline({
    design,
    selected,
    onSelect,
}: {
    design: EmailDesign;
    selected: string | null;
    onSelect: (id: string) => void;
}): JSX.Element | null {
    if (design.blocks.length === 0) return null;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <p className="imcrm-mt-2 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                {__('En el correo')}
            </p>
            {design.blocks.map((b) => (
                <div key={b.id}>
                    <OutlineRow label={__(EMAIL_BLOCK_LABELS[b.type])} active={selected === b.id} onClick={() => onSelect(b.id)} />
                    {b.type === 'columns' &&
                        b.columns.map((c, ci) =>
                            c.blocks.map((ib) => (
                                <OutlineRow
                                    key={ib.id}
                                    indent
                                    label={`${ci + 1} · ${__(EMAIL_BLOCK_LABELS[ib.type])}`}
                                    active={selected === ib.id}
                                    onClick={() => onSelect(ib.id)}
                                />
                            )),
                        )}
                </div>
            ))}
        </div>
    );
}

function OutlineRow({ label, active, onClick, indent }: { label: string; active: boolean; onClick: () => void; indent?: boolean }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'imcrm-flex imcrm-w-full imcrm-items-center imcrm-rounded imcrm-px-2 imcrm-py-1 imcrm-text-left imcrm-text-xs hover:imcrm-bg-accent',
                indent && 'imcrm-pl-5 imcrm-text-muted-foreground',
                active && 'imcrm-bg-primary/10 imcrm-font-medium imcrm-text-primary',
            )}
        >
            {label}
        </button>
    );
}

function ThemePanel({
    design,
    onChange,
}: {
    design: EmailDesign;
    onChange: (patch: Partial<EmailDesign['theme']>, key: string) => void;
}): JSX.Element {
    const t = design.theme;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="email-theme">
            <Field label={__('Tipografía')} hint={__('Fuentes del sistema: las únicas que se ven igual en Gmail y Outlook.')}>
                <Select value={t.font} onChange={(e) => onChange({ font: e.target.value as EmailFont }, 'font')}>
                    {EMAIL_FONTS.map((f) => (
                        <option key={f} value={f}>
                            {EMAIL_FONT_LABELS[f]}
                        </option>
                    ))}
                </Select>
            </Field>
            <Segmented<string>
                label={__('Ancho del correo')}
                value={String(t.width)}
                options={[
                    { value: '520', label: '520' },
                    { value: '600', label: '600' },
                    { value: '660', label: '660' },
                    { value: '720', label: '720' },
                ]}
                onChange={(v) => onChange({ width: Number(v) }, 'width')}
            />
            <Segmented<string>
                label={__('Esquinas')}
                value={String(t.radius)}
                options={[
                    { value: '0', label: __('Rectas') },
                    { value: '4', label: '4' },
                    { value: '8', label: '8' },
                    { value: '12', label: '12' },
                ]}
                onChange={(v) => onChange({ radius: Number(v) }, 'radius')}
            />
            <Section title={__('Colores')}>
                <ColorRow label={__('Acento (botones y enlaces)')} value={t.accent} onChange={(v) => v && onChange({ accent: v }, 'accent')} />
                <ColorRow label={__('Fondo de afuera')} value={t.background} onChange={(v) => v && onChange({ background: v }, 'background')} />
                <ColorRow label={__('Fondo del correo')} value={t.surface} onChange={(v) => v && onChange({ surface: v }, 'surface')} />
                <ColorRow label={__('Texto')} value={t.text} onChange={(v) => v && onChange({ text: v }, 'text')} />
                <ColorRow label={__('Texto secundario')} value={t.muted} onChange={(v) => v && onChange({ muted: v }, 'muted')} />
            </Section>
            <p className="imcrm-rounded-md imcrm-bg-muted/50 imcrm-p-2.5 imcrm-text-[11px] imcrm-leading-relaxed imcrm-text-muted-foreground">
                {__('El correo se arma con tablas y estilos en línea, el formato que entienden Gmail (web y celular), Outlook (Windows, Mac y web), Apple Mail y Yahoo. Outlook de Windows muestra las esquinas rectas.')}
            </p>
        </div>
    );
}

function TemplatesGallery({
    accent,
    onPick,
    onClose,
}: {
    accent: string | null;
    onPick: (key: string) => void;
    onClose: () => void;
}): JSX.Element {
    const thumbs = useMemo(
        () =>
            EMAIL_TEMPLATES.map((t) => ({
                ...t,
                html: renderEmailHtml(emailTemplateDesign(t.key, accent), { resolve: (s) => s, preview: true }),
            })),
        [accent],
    );
    return (
        <div className="imcrm-absolute imcrm-inset-0 imcrm-z-10 imcrm-flex imcrm-flex-col imcrm-bg-background" data-testid="email-templates">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-py-3">
                <div className="imcrm-mr-auto">
                    <h2 className="imcrm-text-base imcrm-font-semibold">{__('Elegí una plantilla')}</h2>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Después cambiás todo: textos, colores, bloques.')}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={onClose}>
                    {__('Volver al editor')}
                </Button>
            </div>
            <div className="imcrm-grid imcrm-flex-1 imcrm-auto-rows-min imcrm-grid-cols-[repeat(auto-fill,minmax(240px,1fr))] imcrm-gap-4 imcrm-overflow-y-auto imcrm-p-4">
                {thumbs.map((t) => (
                    <button
                        key={t.key}
                        type="button"
                        onClick={() => onPick(t.key)}
                        data-template={t.key}
                        className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3 imcrm-text-left hover:imcrm-border-primary/60 hover:imcrm-shadow-imcrm-md"
                    >
                        <EmailThumbnail html={t.html} width={214} height={170} />
                        <span className="imcrm-text-sm imcrm-font-medium">{__(t.name)}</span>
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{__(t.description)}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                'imcrm-flex-1 imcrm-rounded-md imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-bg-accent',
                active && 'imcrm-bg-primary/10 imcrm-text-primary',
            )}
        >
            {children}
        </button>
    );
}

function IconToggle({
    label,
    onClick,
    icon: Icon,
    active,
    disabled,
}: {
    label: string;
    onClick: () => void;
    icon: typeof Monitor;
    active?: boolean;
    disabled?: boolean;
}): JSX.Element {
    return (
        <button
            type="button"
            title={label}
            aria-label={label}
            aria-pressed={active}
            disabled={disabled}
            onClick={onClick}
            className={cn(
                'imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground disabled:imcrm-opacity-40',
                active && 'imcrm-bg-primary/10 imcrm-text-primary',
            )}
        >
            <Icon className="imcrm-h-3.5 imcrm-w-3.5" />
        </button>
    );
}
