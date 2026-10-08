import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import {
    Braces,
    Columns2,
    Database,
    ExternalLink,
    FileDown,
    Heading1,
    Image as ImageIcon,
    LayoutTemplate,
    ListOrdered,
    Loader2,
    Minus,
    MousePointerClick,
    MoveVertical,
    PenLine,
    Redo2,
    ScissorsLineDashed,
    Sigma,
    Table2,
    Type,
    Undo2,
    X,
} from 'lucide-react';
import {
    DOC_BLOCK_HINTS,
    DOC_BLOCK_LABELS,
    DOC_PAGE_SIZE_LABELS,
    DOC_PAGE_SIZES,
    type DocBlockType,
    type DocDesign,
    type DocPageSize,
    type DocumentPreviewResult,
    type DocumentTemplate,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { ColorRow } from '../template-editor-core/BlockStyleEditor';
import { MergeTagInput, type MergeTagSection } from '../automations/MergeTagInput';
import { Check, Field, Section, Segmented } from '../automations/email/EmailBlockInspector';
import { DocumentBlockInspector } from './DocumentBlockInspector';
import {
    appendToDocColumn,
    duplicateDocBlock,
    findDocBlock,
    insertDocBlock,
    locateDocBlock,
    makeDocBlock,
    moveDocBlock,
    removeDocBlock,
    setDocColumnCount,
    updateDocBlock,
} from './documentDesignOps';
import { PdfCanvasPreview } from './PdfCanvasPreview';
import { fetchDocumentTemplate, pdfBlob, previewDocument, useSaveDocumentTemplate } from './useDocuments';

/**
 * v0.1.266 — Editor de documentos PDF a pantalla completa (ADR-S35).
 *
 * Mismo esqueleto que el editor de correos: bloques y la hoja a la izquierda,
 * el documento al centro, los ajustes del bloque elegido a la derecha. La
 * diferencia: el centro es el PDF REAL que arma el servidor (no una
 * aproximación en HTML) y se toca un bloque sobre la página para editarlo.
 */

const PALETTE: Array<{ type: DocBlockType; icon: typeof Type }> = [
    { type: 'header', icon: LayoutTemplate },
    { type: 'heading', icon: Heading1 },
    { type: 'text', icon: Type },
    { type: 'fields', icon: Database },
    { type: 'items', icon: Table2 },
    { type: 'totals', icon: Sigma },
    { type: 'image', icon: ImageIcon },
    { type: 'signature', icon: PenLine },
    { type: 'columns', icon: Columns2 },
    { type: 'divider', icon: Minus },
    { type: 'spacer', icon: MoveVertical },
    { type: 'page_break', icon: ScissorsLineDashed },
];

interface History {
    past: DocDesign[];
    present: DocDesign;
    future: DocDesign[];
    lastKey: string | null;
    lastAt: number;
}

export interface DocumentDesignerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listId: number;
    /** null = plantilla nueva (con `initial`). */
    templateId: number | null;
    initial?: { name: string; filename: string; design: DocDesign };
    fields: FieldEntity[];
    onSaved?: (tpl: DocumentTemplate) => void;
}

export default function DocumentDesigner(props: DocumentDesignerProps): JSX.Element {
    return (
        <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40" />
                <Dialog.Content
                    aria-describedby={undefined}
                    className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-flex imcrm-flex-col imcrm-bg-background imcrm-text-foreground focus:imcrm-outline-none"
                    onEscapeKeyDown={(e) => e.preventDefault()}
                    data-testid="doc-designer"
                >
                    {props.open && <Loader {...props} />}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function Loader(props: DocumentDesignerProps): JSX.Element {
    const [tpl, setTpl] = useState<{ name: string; filename: string; design: DocDesign } | null>(
        props.templateId === null ? props.initial ?? null : null,
    );
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (props.templateId === null) return;
        let alive = true;
        fetchDocumentTemplate(props.listId, props.templateId)
            .then((t) => alive && setTpl({ name: t.name, filename: t.filename, design: t.design }))
            .catch((err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)));
        return () => {
            alive = false;
        };
    }, [props.listId, props.templateId]);
    if (error) {
        return (
            <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-3">
                <Dialog.Title className="imcrm-text-sm imcrm-text-destructive">{error}</Dialog.Title>
                <Button variant="outline" size="sm" onClick={() => props.onOpenChange(false)}>
                    {__('Cerrar')}
                </Button>
            </div>
        );
    }
    if (!tpl) {
        return (
            <div className="imcrm-flex imcrm-h-full imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                <Dialog.Title className="imcrm-sr-only">{__('Diseñar documento')}</Dialog.Title>
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando la plantilla…')}
            </div>
        );
    }
    return <DesignerBody {...props} initialTpl={tpl} />;
}

function DesignerBody(props: DocumentDesignerProps & { initialTpl: { name: string; filename: string; design: DocDesign } }): JSX.Element {
    const toast = useToast();
    const confirm = useConfirm();
    const narrow = useMediaQuery('(max-width: 1023px)');
    const save = useSaveDocumentTemplate(props.listId);
    const [templateId, setTemplateId] = useState<number | null>(props.templateId);
    const [name, setName] = useState(props.initialTpl.name);
    const [filename, setFilename] = useState(props.initialTpl.filename);
    const [hist, setHist] = useState<History>({ past: [], present: props.initialTpl.design, future: [], lastKey: null, lastAt: 0 });
    const design = hist.present;
    const [savedSnapshot, setSavedSnapshot] = useState(() =>
        props.templateId === null ? '' : JSON.stringify([props.initialTpl.name, props.initialTpl.filename, props.initialTpl.design]),
    );
    const dirty = JSON.stringify([name, filename, design]) !== savedSnapshot;
    const [selected, setSelected] = useState<string | null>(null);
    const [leftTab, setLeftTab] = useState<'blocks' | 'page'>('blocks');
    const [mobileTab, setMobileTab] = useState<'add' | 'preview' | 'edit'>('preview');
    const [mode, setMode] = useState<'real' | 'tags'>('real');
    const [recordId, setRecordId] = useState<number | null>(null);
    const [preview, setPreview] = useState<DocumentPreviewResult | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const commit = useCallback((next: DocDesign | ((d: DocDesign) => DocDesign), key: string | null = null) => {
        setHist((h) => {
            const value = typeof next === 'function' ? next(h.present) : next;
            if (value === h.present) return h;
            const now = Date.now();
            const coalesce = key !== null && key === h.lastKey && now - h.lastAt < 900;
            return { past: coalesce ? h.past : [...h.past, h.present].slice(-80), present: value, future: [], lastKey: key, lastAt: now };
        });
    }, []);
    const undo = useCallback(() => {
        setHist((h) => (h.past.length === 0 ? h : { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future], lastKey: null, lastAt: 0 }));
    }, []);
    const redo = useCallback(() => {
        setHist((h) => (h.future.length === 0 ? h : { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1), lastKey: null, lastAt: 0 }));
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

    useEffect(() => {
        if (selected && !findDocBlock(design, selected)) setSelected(null);
    }, [design, selected]);

    // Vista previa: el servidor arma el PDF real (con un respiro al tipear).
    const reqRef = useRef<AbortController | null>(null);
    useEffect(() => {
        const timer = window.setTimeout(() => {
            reqRef.current?.abort();
            const ctrl = new AbortController();
            reqRef.current = ctrl;
            setLoading(true);
            previewDocument(props.listId, { design, mode, record_id: recordId }, ctrl.signal)
                .then((res) => {
                    if (ctrl.signal.aborted) return;
                    setPreview(res);
                    setPreviewError(null);
                })
                .catch((err: unknown) => {
                    if (ctrl.signal.aborted) return;
                    setPreviewError(err instanceof Error ? err.message : String(err));
                })
                .finally(() => {
                    if (!ctrl.signal.aborted) setLoading(false);
                });
        }, 450);
        return () => window.clearTimeout(timer);
    }, [design, mode, recordId, props.listId]);
    useEffect(() => () => reqRef.current?.abort(), []);

    const totalTags: MergeTagSection[] = useMemo(() => {
        const items = design.blocks
            .filter((b) => b.type === 'totals')
            .flatMap((b) => (b.type === 'totals' ? b.rows : []))
            .flatMap((r) => [
                { tag: `totales.${r.id}`, label: r.label || r.id, hint: `{{totales.${r.id}}}` },
                { tag: `totales.${r.id}|pesos|mayusculas`, label: `${r.label || r.id} · ${__('en letras')}`, hint: __('UN MILLÓN DE PESOS') },
            ]);
        return items.length ? [{ title: __('Totales del documento'), items }] : [];
    }, [design.blocks]);

    const selectedBlock = findDocBlock(design, selected);
    const selectedLoc = selected ? locateDocBlock(design, selected) : null;

    const add = (type: DocBlockType): void => {
        const block = makeDocBlock(type);
        commit((d) => insertDocBlock(d, block, selected));
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
            title: __('¿Cerrar sin guardar?'),
            description: __('Los cambios de la plantilla se pierden.'),
            confirmLabel: __('Cerrar sin guardar'),
            destructive: true,
        }).then((ok) => ok && props.onOpenChange(false));
    };

    const doSave = async (): Promise<void> => {
        if (!name.trim()) {
            toast.error(__('Ponele un nombre a la plantilla'));
            return;
        }
        try {
            const saved = await save.mutateAsync({ id: templateId, body: { name: name.trim(), filename: filename.trim(), design } });
            setTemplateId(saved.id);
            setSavedSnapshot(JSON.stringify([name, filename, design]));
            toast.success(__('Plantilla guardada'));
            props.onSaved?.(saved);
        } catch (err) {
            toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : String(err));
        }
    };

    const openPdf = (): void => {
        if (!preview) return;
        const url = URL.createObjectURL(pdfBlob(preview.pdf));
        window.open(url, '_blank', 'noopener');
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };

    const left = (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col">
            <div className="imcrm-flex imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-p-2">
                <TabBtn active={leftTab === 'blocks'} onClick={() => setLeftTab('blocks')}>
                    {__('Bloques')}
                </TabBtn>
                <TabBtn active={leftTab === 'page'} onClick={() => setLeftTab('page')}>
                    {__('Hoja y estilo')}
                </TabBtn>
            </div>
            <div className="imcrm-flex-1 imcrm-overflow-y-auto imcrm-p-3">
                {leftTab === 'blocks' ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            {selected ? __('Se agrega debajo del bloque elegido.') : __('Tocá un bloque para agregarlo al final del documento.')}
                        </p>
                        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2" data-testid="doc-palette">
                            {PALETTE.map(({ type, icon: Icon }) => (
                                <button
                                    key={type}
                                    type="button"
                                    onClick={() => add(type)}
                                    title={__(DOC_BLOCK_HINTS[type])}
                                    data-block-type={type}
                                    className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-1 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2.5 imcrm-text-left hover:imcrm-border-primary/50 hover:imcrm-bg-primary/5"
                                >
                                    <Icon className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" />
                                    <span className="imcrm-text-xs imcrm-font-medium">{__(DOC_BLOCK_LABELS[type])}</span>
                                    <span className="imcrm-line-clamp-2 imcrm-text-[10.5px] imcrm-leading-snug imcrm-text-muted-foreground">
                                        {__(DOC_BLOCK_HINTS[type])}
                                    </span>
                                </button>
                            ))}
                        </div>
                        <Outline design={design} selected={selected} onSelect={onSelect} />
                    </div>
                ) : (
                    <PagePanel
                        design={design}
                        fields={props.fields}
                        filename={filename}
                        onFilename={setFilename}
                        extraTags={totalTags}
                        onTheme={(theme, key) => commit((d) => ({ ...d, theme: { ...d.theme, ...theme } }), key)}
                        onFooter={(footer, key) => commit((d) => ({ ...d, footer: { ...d.footer, ...footer } }), key)}
                    />
                )}
            </div>
        </div>
    );

    const inspector = selectedBlock ? (
        <DocumentBlockInspector
            key={selectedBlock.id}
            block={selectedBlock}
            inColumn={selectedLoc?.parentId !== null && selectedLoc?.parentId !== undefined}
            design={design}
            fields={props.fields}
            listId={props.listId}
            extraTags={totalTags}
            onPatch={(patch) => commit((d) => updateDocBlock(d, selectedBlock.id, patch), `${selectedBlock.id}:${Object.keys(patch).join(',')}`)}
            onMove={(delta) => commit((d) => moveDocBlock(d, selectedBlock.id, delta))}
            onDuplicate={() => {
                const r = duplicateDocBlock(design, selectedBlock.id);
                commit(r.design);
                if (r.newId) setSelected(r.newId);
            }}
            onRemove={() => {
                commit((d) => removeDocBlock(d, selectedBlock.id));
                setSelected(null);
            }}
            onSelect={onSelect}
            onAppendToColumn={(ci, block) => {
                commit((d) => appendToDocColumn(d, selectedBlock.id, ci, block));
                setSelected(block.id);
            }}
            onSetColumns={(n) => commit((d) => setDocColumnCount(d, selectedBlock.id, n))}
        />
    ) : (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-p-6 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
            <MousePointerClick className="imcrm-h-6 imcrm-w-6" />
            {__('Tocá un bloque en el documento para editarlo.')}
        </div>
    );

    const banner = (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-bg-card imcrm-px-3 imcrm-py-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">
            {mode === 'real' ? (
                preview?.record_id ? (
                    <span>
                        {__('Con los datos del registro')} #{preview.record_id}
                    </span>
                ) : (
                    <span>{__('La lista no tiene registros: las variables quedan vacías.')}</span>
                )
            ) : (
                <span>{__('Mostrando las variables. Así ves qué dato va en cada lugar.')}</span>
            )}
            {mode === 'real' && (
                <label className="imcrm-ml-auto imcrm-flex imcrm-items-center imcrm-gap-1">
                    {__('Registro')} #
                    <input
                        type="number"
                        min={1}
                        defaultValue={recordId ?? ''}
                        placeholder={__('último')}
                        onBlur={(e) => setRecordId(e.target.value ? Number(e.target.value) : null)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                        }}
                        className="imcrm-h-6 imcrm-w-24 imcrm-rounded imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-1.5 imcrm-text-[11px]"
                        aria-label={__('Registro de ejemplo')}
                    />
                </label>
            )}
            {preview && preview.warnings.length > 0 && (
                <span className="imcrm-w-full imcrm-text-amber-700 dark:imcrm-text-amber-300">{preview.warnings.join(' · ')}</span>
            )}
            {previewError && <span className="imcrm-w-full imcrm-text-destructive">{previewError}</span>}
        </div>
    );

    const center = (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col">
            {banner}
            <div className="imcrm-min-h-0 imcrm-flex-1">
                <PdfCanvasPreview
                    pdf={preview?.pdf ?? null}
                    regions={preview?.regions ?? []}
                    pageWidth={preview?.page_width ?? 612}
                    pageHeight={preview?.page_height ?? 792}
                    selectedId={selected}
                    onSelect={onSelect}
                    loading={loading}
                />
            </div>
        </div>
    );

    return (
        <>
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-3 imcrm-py-2">
                <Dialog.Title className="imcrm-sr-only">{__('Diseñar documento')}</Dialog.Title>
                <FileDown className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" />
                <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="imcrm-h-8 imcrm-max-w-[260px] imcrm-flex-1 imcrm-text-sm imcrm-font-semibold"
                    aria-label={__('Nombre de la plantilla')}
                    data-testid="doc-name"
                />
                <div className="imcrm-mr-auto" />
                <div className="imcrm-flex imcrm-items-center imcrm-gap-0.5">
                    <IconToggle label={__('Deshacer (Ctrl+Z)')} onClick={undo} disabled={hist.past.length === 0} icon={Undo2} />
                    <IconToggle label={__('Rehacer (Ctrl+Shift+Z)')} onClick={redo} disabled={hist.future.length === 0} icon={Redo2} />
                </div>
                <div role="group" aria-label={__('Datos de la vista previa')} className="imcrm-flex imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-0.5">
                    <IconToggle label={__('Ver con datos de un registro')} active={mode === 'real'} onClick={() => setMode('real')} icon={Database} />
                    <IconToggle label={__('Ver las variables')} active={mode === 'tags'} onClick={() => setMode('tags')} icon={Braces} />
                </div>
                <Button variant="outline" size="sm" className="imcrm-gap-1.5" onClick={openPdf} disabled={!preview}>
                    <ExternalLink className="imcrm-h-3.5 imcrm-w-3.5" />
                    <span className="imcrm-hidden sm:imcrm-inline">{__('Abrir PDF')}</span>
                </Button>
                <Button size="sm" onClick={() => void doSave()} disabled={save.isPending} data-testid="doc-save">
                    {save.isPending && <Loader2 className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                    {templateId === null ? __('Crear plantilla') : __('Guardar')}
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
                            {__('Documento')}
                        </TabBtn>
                        <TabBtn active={mobileTab === 'edit'} onClick={() => setMobileTab('edit')}>
                            {__('Editar')}
                        </TabBtn>
                    </div>
                    <div className="imcrm-min-h-0 imcrm-flex-1">
                        {mobileTab === 'add' && left}
                        {mobileTab === 'preview' && center}
                        {mobileTab === 'edit' && <div className="imcrm-h-full imcrm-overflow-y-auto imcrm-p-3">{inspector}</div>}
                    </div>
                </div>
            ) : (
                <div className="imcrm-grid imcrm-min-h-0 imcrm-flex-1 imcrm-grid-cols-[280px_minmax(0,1fr)_360px]">
                    <aside className="imcrm-min-h-0 imcrm-border-r imcrm-border-border">{left}</aside>
                    <main className="imcrm-min-h-0">{center}</main>
                    <aside className="imcrm-min-h-0 imcrm-overflow-y-auto imcrm-border-l imcrm-border-border imcrm-p-4">{inspector}</aside>
                </div>
            )}
        </>
    );
}

function Outline({ design, selected, onSelect }: { design: DocDesign; selected: string | null; onSelect: (id: string) => void }): JSX.Element | null {
    if (design.blocks.length === 0) return null;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="doc-outline">
            <p className="imcrm-mt-2 imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                <ListOrdered className="imcrm-h-3 imcrm-w-3" />
                {__('En el documento')}
            </p>
            {design.blocks.map((b) => (
                <div key={b.id}>
                    <OutlineRow label={__(DOC_BLOCK_LABELS[b.type])} active={selected === b.id} onClick={() => onSelect(b.id)} />
                    {b.type === 'columns' &&
                        b.columns.map((c, ci) =>
                            c.blocks.map((ib) => (
                                <OutlineRow key={ib.id} indent label={`${ci + 1} · ${__(DOC_BLOCK_LABELS[ib.type])}`} active={selected === ib.id} onClick={() => onSelect(ib.id)} />
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

function PagePanel({
    design,
    fields,
    filename,
    onFilename,
    extraTags,
    onTheme,
    onFooter,
}: {
    design: DocDesign;
    fields: FieldEntity[];
    filename: string;
    onFilename: (v: string) => void;
    extraTags: MergeTagSection[];
    onTheme: (patch: Partial<DocDesign['theme']>, key: string) => void;
    onFooter: (patch: Partial<DocDesign['footer']>, key: string) => void;
}): JSX.Element {
    const t = design.theme;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="doc-page-panel">
            <Field label={__('Tamaño de la hoja')}>
                <Select value={t.page_size} onChange={(e) => onTheme({ page_size: e.target.value as DocPageSize }, 'page_size')}>
                    {DOC_PAGE_SIZES.map((s) => (
                        <option key={s} value={s}>
                            {__(DOC_PAGE_SIZE_LABELS[s])}
                        </option>
                    ))}
                </Select>
            </Field>
            <Segmented<'portrait' | 'landscape'>
                label={__('Orientación')}
                value={t.orientation}
                options={[
                    { value: 'portrait', label: __('Vertical') },
                    { value: 'landscape', label: __('Horizontal') },
                ]}
                onChange={(v) => onTheme({ orientation: v }, 'orientation')}
            />
            <Segmented<'narrow' | 'normal' | 'wide'>
                label={__('Márgenes')}
                value={t.margin}
                options={[
                    { value: 'narrow', label: __('Angostos') },
                    { value: 'normal', label: __('Normales') },
                    { value: 'wide', label: __('Anchos') },
                ]}
                onChange={(v) => onTheme({ margin: v }, 'margin')}
            />
            <Segmented<string>
                label={__('Tamaño del texto')}
                value={String(t.font_size)}
                options={[9, 10, 11, 12].map((n) => ({ value: String(n), label: `${n} pt` }))}
                onChange={(v) => onTheme({ font_size: Number(v) }, 'font_size')}
            />
            <Section title={__('Colores')}>
                <ColorRow label={__('Acento (títulos, tabla, total)')} value={t.accent} onChange={(v) => v && onTheme({ accent: v }, 'accent')} />
                <ColorRow label={__('Texto')} value={t.text} onChange={(v) => v && onTheme({ text: v }, 'text')} />
                <ColorRow label={__('Texto secundario')} value={t.muted} onChange={(v) => v && onTheme({ muted: v }, 'muted')} />
                <ColorRow label={__('Líneas')} value={t.border} onChange={(v) => v && onTheme({ border: v }, 'border')} />
            </Section>
            <Section title={__('Pie de página')}>
                <Check label={__('Numerar las páginas («Página 1 de 2»)')} checked={design.footer.page_numbers} onChange={(v) => onFooter({ page_numbers: v }, 'page_numbers')} />
                <Field label={__('Texto del pie (opcional)')}>
                    <MergeTagInput value={design.footer.text} onChange={(v) => onFooter({ text: v }, 'footer_text')} fields={fields} tagContext="document" extraTags={extraTags} />
                </Field>
            </Section>
            <Section title={__('Archivo')}>
                <Field label={__('Nombre del archivo')} hint={__('Con variables: «Cuenta de cobro {{record.id}} - {{cliente}}». Se le agrega .pdf solo.')}>
                    <MergeTagInput value={filename} onChange={onFilename} fields={fields} tagContext="document" extraTags={extraTags} />
                </Field>
            </Section>
            <p className="imcrm-rounded-md imcrm-bg-muted/50 imcrm-p-2.5 imcrm-text-[11px] imcrm-leading-relaxed imcrm-text-muted-foreground">
                {__('Este documento no es una factura electrónica de la DIAN: sirve para cuentas de cobro, recibos, cotizaciones y órdenes de servicio.')}
            </p>
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
    icon: typeof Undo2;
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
