import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
    Braces,
    Code2,
    Columns2,
    Database,
    Heading1,
    Image as ImageIcon,
    GripVertical,
    LayoutTemplate,
    Loader2,
    Minus,
    Monitor,
    Moon,
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
    type EmailBlock,
    type EmailBlockType,
    type EmailDesign,
    type EmailFont,
    type EmailInnerBlock,
    type EmailTestResult,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ThemeToggle } from '@/components/ThemeToggle';
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
    canDrop,
    duplicateBlock,
    findBlock,
    insertAt,
    insertBlock,
    isNoopDrop,
    locate,
    makeBlock,
    moveBlock,
    moveTo,
    removeBlock,
    setColumnCount,
    updateBlock,
    type DragSource,
    type DropTarget,
} from './emailDesignOps';
import { resolveDrop } from './emailDnd';
import { EmailPreviewFrame, EmailThumbnail, type BlockAction, type PreviewDnd } from './EmailPreviewFrame';

/**
 * v0.1.265 — Editor de correos a pantalla completa (ADR-S34).
 *
 * Izquierda: los bloques para agregar y el estilo general (colores,
 * tipografía, ancho). Centro: el correo REAL (el mismo HTML que sale por
 * Gmail/Outlook), en escritorio o celular, con las variables como pastillas
 * o resueltas contra un registro de la lista. Derecha: los ajustes del bloque
 * elegido. Deshacer/rehacer con Ctrl+Z / Ctrl+Shift+Z.
 *
 * v0.1.270 — Arrastrar y soltar (del panel al correo, y para reordenar en la
 * vista previa o en el esquema, también entre columnas), barra flotante del
 * bloque elegido, vista en modo oscuro (con los colores propios del tema o la
 * simulación de Gmail/Outlook), celular a 375px reales y atajos de teclado
 * que funcionan también con el foco dentro de la vista previa.
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
    const [scheme, setScheme] = useState<'light' | 'dark'>('light');
    const [dataMode, setDataMode] = useState<'tags' | 'real'>('tags');
    const [leftTab, setLeftTab] = useState<'blocks' | 'style'>('blocks');
    const [mobileTab, setMobileTab] = useState<'add' | 'preview' | 'edit'>('preview');
    const [showTemplates, setShowTemplates] = useState(Boolean(props.startWithTemplates));
    const [dragging, setDragging] = useState<DragSource | null>(null);
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

    const designRef = useRef(design);
    designRef.current = design;
    const selectedRef = useRef(selected);
    selectedRef.current = selected;

    // La selección se limpia si el bloque desaparece (deshacer, borrar).
    useEffect(() => {
        if (selected && !findBlock(design, selected)) setSelected(null);
    }, [design, selected]);

    const blockAction = useCallback(
        (action: BlockAction, id: string | null = selectedRef.current) => {
            if (!id || id === '__signature') return;
            if (action === 'up' || action === 'down') {
                commit((d) => moveBlock(d, id, action === 'up' ? -1 : 1));
            } else if (action === 'duplicate') {
                const r = duplicateBlock(designRef.current, id);
                commit(r.design);
                if (r.newId) setSelected(r.newId);
            } else {
                commit((d) => removeBlock(d, id));
                setSelected(null);
            }
        },
        [commit],
    );

    // Atajos: los mismos con el foco en la app o DENTRO de la vista previa
    // (un iframe tiene su propio documento: sin reenviar, Ctrl+Z no andaba
    // después de tocar un bloque).
    const onKey = useCallback(
        (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            const typing = Boolean(target?.closest?.('input, textarea, select, [contenteditable="true"]'));
            if (typing) return;
            const mod = e.ctrlKey || e.metaKey;
            const key = e.key.toLowerCase();
            if (mod && key === 'z') {
                e.preventDefault();
                if (e.shiftKey) redo();
                else undo();
            } else if (mod && key === 'y') {
                e.preventDefault();
                redo();
            } else if (mod && key === 'd' && selectedRef.current) {
                e.preventDefault();
                blockAction('duplicate');
            } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRef.current) {
                e.preventDefault();
                blockAction('remove');
            } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && selectedRef.current) {
                e.preventDefault();
                blockAction(e.key === 'ArrowUp' ? 'up' : 'down');
            } else if (e.key === 'Escape' && selectedRef.current) {
                setSelected(null);
            }
        },
        [undo, redo, blockAction],
    );
    useEffect(() => {
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onKey]);

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
    const siblings = selectedLoc ? siblingCount(design, selectedLoc.parentId, selectedLoc.columnIndex) : 0;

    // --- Arrastrar y soltar ---------------------------------------------------
    const dragRef = useRef<DragSource | null>(null);
    const startDrag = useCallback((src: DragSource) => {
        dragRef.current = src;
        setDragging(src);
    }, []);
    const endDrag = useCallback(() => {
        dragRef.current = null;
        setDragging(null);
    }, []);
    const dropAt = useCallback(
        (target: DropTarget) => {
            const src = dragRef.current;
            if (!src) return;
            const d = designRef.current;
            if (src.kind === 'new') {
                const r = insertAt(d, src.type, target);
                if (r.id) {
                    commit(r.design);
                    setSelected(r.id);
                }
            } else {
                const next = moveTo(d, src.id, target);
                if (next !== d) {
                    commit(next);
                    setSelected(src.id);
                }
            }
            endDrag();
        },
        [commit, endDrag],
    );
    const dnd = useMemo<PreviewDnd>(
        () => ({
            current: () => dragRef.current,
            start: startDrag,
            end: endDrag,
            resolve: (x, y, g) => (dragRef.current ? resolveDrop(designRef.current, dragRef.current, x, y, g) : null),
            drop: dropAt,
        }),
        [startDrag, endDrag, dropAt],
    );
    // Un arrastre que termina afuera de todo (o se cancela con Escape) no
    // deja el estado colgado.
    useEffect(() => {
        if (!dragging) return;
        const clear = (): void => endDrag();
        window.addEventListener('dragend', clear);
        window.addEventListener('drop', clear);
        return () => {
            window.removeEventListener('dragend', clear);
            window.removeEventListener('drop', clear);
        };
    }, [dragging, endDrag]);

    const add = (type: EmailBlockType): void => {
        const block = makeBlock(type);
        commit((d) => insertBlock(d, block, selected));
        setSelected(block.id);
        if (narrow) setMobileTab('edit');
    };

    const onSelect = (id: string | null): void => {
        setSelected(id === '__signature' ? null : id);
        if (id && id !== '__signature' && narrow) setMobileTab('edit');
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
                            {narrow
                                ? selected
                                    ? __('Tocá un bloque: se agrega debajo del elegido.')
                                    : __('Tocá un bloque para agregarlo al final del correo.')
                                : __('Arrastrá un bloque al correo y soltalo donde quieras, o hacé clic para agregarlo debajo del elegido.')}
                        </p>
                        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2" data-testid="email-palette">
                            {PALETTE.map(({ type, icon: Icon }) => (
                                <button
                                    key={type}
                                    type="button"
                                    draggable={!narrow}
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData('text/plain', '');
                                        e.dataTransfer.effectAllowed = 'copy';
                                        startDrag({ kind: 'new', type });
                                    }}
                                    onDragEnd={endDrag}
                                    onClick={() => add(type)}
                                    title={__(EMAIL_BLOCK_HINTS[type])}
                                    data-block-type={type}
                                    className={cn(
                                        'imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-1 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2.5 imcrm-text-left hover:imcrm-border-primary/50 hover:imcrm-bg-primary/5',
                                        !narrow && 'imcrm-cursor-grab active:imcrm-cursor-grabbing',
                                        dragging?.kind === 'new' && dragging.type === type && 'imcrm-border-primary imcrm-bg-primary/10',
                                    )}
                                >
                                    <Icon className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" />
                                    <span className="imcrm-text-xs imcrm-font-medium">{__(EMAIL_BLOCK_LABELS[type])}</span>
                                    <span className="imcrm-line-clamp-2 imcrm-text-[10.5px] imcrm-leading-snug imcrm-text-muted-foreground">
                                        {__(EMAIL_BLOCK_HINTS[type])}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <Outline
                            design={design}
                            selected={selected}
                            onSelect={onSelect}
                            draggable={!narrow}
                            dragging={dragging}
                            onDragStart={startDrag}
                            onDragEnd={endDrag}
                            onDrop={dropAt}
                        />
                    </div>
                ) : (
                    <ThemePanel
                        design={design}
                        onChange={(theme, key) => commit((d) => ({ ...d, theme: { ...d.theme, ...theme } }), key)}
                        previewingDark={scheme === 'dark'}
                        onPreviewDark={(on) => setScheme(on ? 'dark' : 'light')}
                    />
                )}
            </div>
        </div>
    );

    const inspector = selectedBlock ? (
        <EmailBlockInspector
            key={selectedBlock.id}
            block={selectedBlock}
            inColumn={selectedLoc?.parentId !== null && selectedLoc?.parentId !== undefined}
            canMoveUp={(selectedLoc?.index ?? 0) > 0}
            canMoveDown={(selectedLoc?.index ?? 0) < siblings - 1}
            design={design}
            fields={props.fields}
            signatureHint={props.signatureHint}
            onPatch={(patch) => commit((d) => updateBlock(d, selectedBlock.id, patch), `${selectedBlock.id}:${Object.keys(patch).join(',')}`)}
            onMove={(delta) => blockAction(delta === -1 ? 'up' : 'down', selectedBlock.id)}
            onDuplicate={() => blockAction('duplicate', selectedBlock.id)}
            onRemove={() => blockAction('remove', selectedBlock.id)}
            onSelect={onSelect}
            onAppendToColumn={(ci, block) => {
                commit((d) => appendToColumn(d, selectedBlock.id, ci, block));
                setSelected(block.id);
            }}
            onSetColumns={(n) => commit((d) => setColumnCount(d, selectedBlock.id, n))}
        />
    ) : (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-3 imcrm-p-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
            <MousePointerClick className="imcrm-h-6 imcrm-w-6" />
            {__('Tocá un bloque en la vista previa para editarlo.')}
            {!narrow && (
                <ul className="imcrm-mt-2 imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-left imcrm-text-[11px] imcrm-leading-snug">
                    <li>{__('Arrastrá los bloques para cambiarlos de lugar (también entre columnas).')}</li>
                    <li>
                        <Kbd>Supr</Kbd> {__('elimina')} · <Kbd>Ctrl</Kbd>+<Kbd>D</Kbd> {__('duplica')} · <Kbd>Alt</Kbd>+<Kbd>↑↓</Kbd> {__('mueve')}
                    </li>
                    <li>
                        <Kbd>Ctrl</Kbd>+<Kbd>Z</Kbd> {__('deshace')} · <Kbd>Ctrl</Kbd>+<Kbd>Shift</Kbd>+<Kbd>Z</Kbd> {__('rehace')}
                    </li>
                </ul>
            )}
        </div>
    );

    const banner =
        dataMode === 'real' ? (
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-bg-amber-50 imcrm-px-3 imcrm-py-1.5 imcrm-text-[11px] imcrm-text-amber-900 dark:imcrm-bg-amber-950/40 dark:imcrm-text-amber-200">
                {realLoading && <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />}
                {real?.error
                    ? real.error
                    : real?.sample_record_id
                      ? `${__('Con los datos del registro')} #${real.sample_record_id}. ${real.signature_note ?? ''} ${__('Para mover o editar bloques, volvé a «Ver las variables».')}`
                      : __('La lista no tiene registros: las variables quedan vacías.')}
            </div>
        ) : null;
    const darkBanner =
        scheme === 'dark' ? (
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1 imcrm-border-b imcrm-border-border imcrm-bg-muted/60 imcrm-px-3 imcrm-py-1.5 imcrm-text-[11px] imcrm-text-muted-foreground" data-testid="email-dark-note">
                <Moon className="imcrm-h-3 imcrm-w-3" />
                {design.theme.dark?.enabled
                    ? __('Con tus colores para modo oscuro (Apple Mail, Outlook de Mac, iOS y web). Gmail aplica su propio modo oscuro.')
                    : __('Simulación: así oscurecen el correo Gmail y Outlook por su cuenta. Para elegir vos los colores, activá «Modo oscuro» en Estilo general.')}
                {!design.theme.dark?.enabled && (
                    <button
                        type="button"
                        className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                        onClick={() => {
                            setLeftTab('style');
                            if (narrow) setMobileTab('add');
                        }}
                    >
                        {__('Elegir colores')}
                    </button>
                )}
                <button
                    type="button"
                    className="imcrm-ml-auto imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                    onClick={() => setScheme('light')}
                    data-testid="email-dark-exit"
                >
                    {__('Volver a la vista normal')}
                </button>
            </div>
        ) : null;

    const toolbarInfo =
        selectedBlock && dataMode === 'tags'
            ? {
                  label: __(EMAIL_BLOCK_LABELS[selectedBlock.type]),
                  canUp: (selectedLoc?.index ?? 0) > 0,
                  canDown: (selectedLoc?.index ?? 0) < siblings - 1,
              }
            : null;

    const preview = (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-bg-canvas">
            {banner}
            {darkBanner}
            <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1 imcrm-justify-center imcrm-overflow-hidden imcrm-p-3">
                <div
                    className={cn(
                        'imcrm-h-full imcrm-overflow-hidden imcrm-shadow-imcrm-md',
                        scheme === 'dark' ? 'imcrm-bg-neutral-900' : 'imcrm-bg-white',
                        device === 'mobile'
                            ? 'imcrm-max-h-[860px] imcrm-shrink-0 imcrm-rounded-[26px] imcrm-border-[6px] imcrm-border-neutral-800'
                            : 'imcrm-w-full imcrm-rounded-md',
                    )}
                    // 375px de pantalla real (el ancho de un iPhone) + el marco.
                    style={device === 'mobile' ? { width: 375 + 12, maxWidth: '100%' } : undefined}
                    data-device={device}
                >
                    <EmailPreviewFrame
                        html={dataMode === 'real' ? real?.html ?? '' : previewHtml}
                        onSelect={onSelect}
                        interactive={dataMode === 'tags'}
                        dark={scheme === 'dark'}
                        dnd={narrow ? undefined : dnd}
                        toolbar={toolbarInfo}
                        onAction={(a) => blockAction(a)}
                        onKeyDown={onKey}
                    />
                </div>
            </div>
        </div>
    );

    return (
        <>
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-3 imcrm-py-2">
                <Dialog.Title className="imcrm-mr-auto imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                    {__('Diseñar correo')}
                    {props.subject && (
                        <span className="imcrm-hidden imcrm-max-w-[280px] imcrm-truncate imcrm-font-normal imcrm-text-muted-foreground sm:imcrm-inline">
                            · {props.subject}
                        </span>
                    )}
                </Dialog.Title>
                <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={() => setShowTemplates(true)}>
                    <LayoutTemplate className="imcrm-h-3.5 imcrm-w-3.5" />
                    <span className="imcrm-hidden sm:imcrm-inline">{__('Plantillas')}</span>
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
                {/* El modo claro/oscuro de la APP (la barra superior queda tapada por el editor). */}
                <ThemeToggle compact />
                <Button variant="ghost" size="sm" className="imcrm-hidden sm:imcrm-inline-flex" onClick={close}>
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

function siblingCount(design: EmailDesign, parentId: string | null, columnIndex: number | null): number {
    if (parentId === null) return design.blocks.length;
    const cols = design.blocks.find((b) => b.id === parentId);
    return cols?.type === 'columns' ? (cols.columns[columnIndex ?? 0]?.blocks.length ?? 0) : 0;
}

function Kbd({ children }: { children: React.ReactNode }): JSX.Element {
    return (
        <kbd className="imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-muted imcrm-px-1 imcrm-font-mono imcrm-text-[10px] imcrm-text-foreground">
            {children}
        </kbd>
    );
}

/** Resumen corto de un bloque para el esquema ("Título · ¡Bienvenido!"). */
function blockSummary(b: EmailBlock | EmailInnerBlock): string {
    switch (b.type) {
        case 'heading':
            return b.text;
        case 'button':
            return b.label;
        case 'text': {
            return (b.doc?.content ?? [])
                .map((p) => (p.content ?? []).map((n) => (typeof n.text === 'string' ? n.text : '')).join(''))
                .join(' ')
                .trim();
        }
        case 'image':
            return b.alt;
        case 'fields':
            return b.title || (b.slugs.length ? `${b.slugs.length} ${__('campos')}` : '');
        case 'spacer':
            return `${b.height}px`;
        case 'columns':
            return `${b.columns.length} ${__('columnas')}`;
        default:
            return '';
    }
}

interface OutlineDrop {
    key: string;
    target: DropTarget;
    pos: 'before' | 'after';
}

function Outline({
    design,
    selected,
    onSelect,
    draggable,
    dragging,
    onDragStart,
    onDragEnd,
    onDrop,
}: {
    design: EmailDesign;
    selected: string | null;
    onSelect: (id: string) => void;
    draggable: boolean;
    dragging: DragSource | null;
    onDragStart: (src: DragSource) => void;
    onDragEnd: () => void;
    onDrop: (target: DropTarget) => void;
}): JSX.Element | null {
    const [hint, setHint] = useState<OutlineDrop | null>(null);
    useEffect(() => {
        if (!dragging) setHint(null);
    }, [dragging]);
    if (design.blocks.length === 0) return null;

    /** Fila soltable: arriba/abajo según la mitad en la que está el puntero. */
    const rowDnd = (key: string, before: DropTarget, after: DropTarget) => ({
        onDragOver: (e: React.DragEvent) => {
            if (!dragging) return;
            const r = e.currentTarget.getBoundingClientRect();
            const pos: 'before' | 'after' = e.clientY < r.top + r.height / 2 ? 'before' : 'after';
            const target = pos === 'before' ? before : after;
            if (!canDrop(design, dragging, target) || isNoopDrop(design, dragging, target)) {
                if (hint?.key === key) setHint(null);
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            if (hint?.key !== key || hint.pos !== pos) setHint({ key, target, pos });
        },
        onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            e.stopPropagation();
            const t = hint?.key === key ? hint.target : null;
            setHint(null);
            if (t) onDrop(t);
            else onDragEnd();
        },
    });

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5" data-testid="email-outline" onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setHint(null)}>
            <p className="imcrm-mt-2 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                {__('En el correo')}
            </p>
            {design.blocks.map((b, i) => {
                const top = (index: number): DropTarget => ({ parentId: null, columnIndex: null, index });
                return (
                    <div key={b.id}>
                        <OutlineRow
                            id={b.id}
                            label={__(EMAIL_BLOCK_LABELS[b.type])}
                            summary={blockSummary(b)}
                            active={selected === b.id}
                            onClick={() => onSelect(b.id)}
                            draggable={draggable}
                            onDragStart={() => onDragStart({ kind: 'move', id: b.id })}
                            onDragEnd={onDragEnd}
                            hint={hint?.key === b.id ? hint.pos : null}
                            {...rowDnd(b.id, top(i), top(i + 1))}
                        />
                        {b.type === 'columns' &&
                            b.columns.map((c, ci) => {
                                const inCol = (index: number): DropTarget => ({ parentId: b.id, columnIndex: ci, index });
                                const headKey = `${b.id}:${ci}`;
                                return (
                                    <div key={ci} className="imcrm-ml-3 imcrm-border-l imcrm-border-border imcrm-pl-2">
                                        <div
                                            className={cn(
                                                'imcrm-relative imcrm-px-2 imcrm-py-0.5 imcrm-text-[10.5px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground',
                                                hint?.key === headKey && 'imcrm-rounded imcrm-bg-primary/10 imcrm-text-primary',
                                            )}
                                            {...rowDnd(headKey, inCol(0), inCol(0))}
                                        >
                                            {__('Columna')} {ci + 1}
                                            {c.blocks.length === 0 && <span className="imcrm-ml-1 imcrm-normal-case imcrm-tracking-normal">· {__('vacía')}</span>}
                                        </div>
                                        {c.blocks.map((ib, ii) => (
                                            <OutlineRow
                                                key={ib.id}
                                                id={ib.id}
                                                label={__(EMAIL_BLOCK_LABELS[ib.type])}
                                                summary={blockSummary(ib)}
                                                active={selected === ib.id}
                                                onClick={() => onSelect(ib.id)}
                                                draggable={draggable}
                                                onDragStart={() => onDragStart({ kind: 'move', id: ib.id })}
                                                onDragEnd={onDragEnd}
                                                hint={hint?.key === ib.id ? hint.pos : null}
                                                {...rowDnd(ib.id, inCol(ii), inCol(ii + 1))}
                                            />
                                        ))}
                                    </div>
                                );
                            })}
                    </div>
                );
            })}
        </div>
    );
}

function OutlineRow({
    id,
    label,
    summary,
    active,
    onClick,
    draggable,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDrop,
    hint,
}: {
    id: string;
    label: string;
    summary: string;
    active: boolean;
    onClick: () => void;
    draggable: boolean;
    onDragStart: () => void;
    onDragEnd: () => void;
    onDragOver: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    hint: 'before' | 'after' | null;
}): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            draggable={draggable}
            onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', '');
                e.dataTransfer.effectAllowed = 'move';
                onDragStart();
            }}
            onDragEnd={onDragEnd}
            onDragOver={onDragOver}
            onDrop={onDrop}
            data-outline-id={id}
            className={cn(
                'imcrm-group imcrm-relative imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-1.5 imcrm-rounded imcrm-px-1.5 imcrm-py-1 imcrm-text-left imcrm-text-xs hover:imcrm-bg-accent',
                active && 'imcrm-bg-primary/10 imcrm-font-medium imcrm-text-primary',
            )}
        >
            {hint && (
                <span
                    aria-hidden
                    className={cn(
                        'imcrm-pointer-events-none imcrm-absolute imcrm-inset-x-0 imcrm-h-0.5 imcrm-rounded imcrm-bg-primary',
                        hint === 'before' ? '-imcrm-top-px' : '-imcrm-bottom-px',
                    )}
                />
            )}
            {draggable && <GripVertical className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-muted-foreground/50 group-hover:imcrm-text-muted-foreground" />}
            <span className="imcrm-shrink-0">{label}</span>
            {summary && <span className="imcrm-min-w-0 imcrm-truncate imcrm-font-normal imcrm-text-muted-foreground">· {summary}</span>}
        </button>
    );
}

function ThemePanel({
    design,
    onChange,
    previewingDark,
    onPreviewDark,
}: {
    design: EmailDesign;
    onChange: (patch: Partial<EmailDesign['theme']>, key: string) => void;
    previewingDark: boolean;
    onPreviewDark: (on: boolean) => void;
}): JSX.Element {
    const t = design.theme;
    const dark = t.dark ?? { enabled: false, background: '#0f1115', surface: '#1b1d22', text: '#e8eaed', muted: '#a1a7b3' };
    const setDark = (patch: Partial<typeof dark>, key: string): void => onChange({ dark: { ...dark, ...patch } }, key);
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
            <Section title={__('Modo oscuro')}>
                <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-start imcrm-gap-2 imcrm-text-xs" data-testid="email-dark-toggle">
                    <input
                        type="checkbox"
                        className="imcrm-mt-0.5"
                        checked={dark.enabled}
                        onChange={(e) => {
                            setDark({ enabled: e.target.checked }, 'dark.enabled');
                            if (e.target.checked) onPreviewDark(true);
                        }}
                    />
                    <span className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                        <span className="imcrm-font-medium">{__('Usar mis colores cuando el correo se lee en modo oscuro')}</span>
                        <span className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                            {__('Los respetan Apple Mail y Outlook (Mac, iOS y web). Gmail aplica su propio modo oscuro siempre. Las bandas de color de los bloques conservan sus colores.')}
                        </span>
                    </span>
                </label>
                {dark.enabled && (
                    <>
                        <ColorRow label={__('Fondo de afuera')} value={dark.background} onChange={(v) => v && setDark({ background: v }, 'dark.background')} />
                        <ColorRow label={__('Fondo del correo')} value={dark.surface} onChange={(v) => v && setDark({ surface: v }, 'dark.surface')} />
                        <ColorRow label={__('Texto')} value={dark.text} onChange={(v) => v && setDark({ text: v }, 'dark.text')} />
                        <ColorRow label={__('Texto secundario')} value={dark.muted} onChange={(v) => v && setDark({ muted: v }, 'dark.muted')} />
                    </>
                )}
                <button
                    type="button"
                    className="imcrm-self-start imcrm-text-[11px] imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                    onClick={() => onPreviewDark(!previewingDark)}
                    data-testid="email-dark-preview"
                >
                    {previewingDark
                        ? __('Volver a la vista normal del correo')
                        : dark.enabled
                          ? __('Ver el correo como se lee en modo oscuro')
                          : __('Ver cómo lo oscurecen Gmail y Outlook')}
                </button>
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
