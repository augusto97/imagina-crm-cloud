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
    QrCode,
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
    formatDocNumber,
    type DocBlockType,
    type DocDesign,
    type DocPageSize,
    type DocumentPreviewResult,
    type DocumentTemplate,
} from '@imagina-base/shared';

import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { ColorField, FontSelect, NumberField } from '@/components/design/DesignStyleControls';

import { MergeTagInput, type MergeTagSection } from '../automations/MergeTagInput';
import { Check, Field, Section, Segmented } from '../automations/email/EmailBlockInspector';
import { DocumentBlockInspector } from './DocumentBlockInspector';
import type { InspectorTab } from '../automations/email/EmailBlockInspector';
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
    { type: 'qr', icon: QrCode },
    { type: 'signature', icon: PenLine },
    { type: 'columns', icon: Columns2 },
    { type: 'divider', icon: Minus },
    { type: 'spacer', icon: MoveVertical },
    { type: 'page_break', icon: ScissorsLineDashed },
];

/** Lo que se edita de una plantilla (además del diseño, el portal y el consecutivo). */
interface TemplateDraft {
    name: string;
    filename: string;
    design: DocDesign;
    portal_visible?: boolean;
    /** Próximo número a emitir (sólo plantillas ya guardadas). */
    next_number?: number;
}

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
    initial?: TemplateDraft;
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
    const [tpl, setTpl] = useState<TemplateDraft | null>(
        props.templateId === null ? props.initial ?? null : null,
    );
    const [error, setError] = useState<string | null>(null);
    useEffect(() => {
        if (props.templateId === null) return;
        let alive = true;
        fetchDocumentTemplate(props.listId, props.templateId)
            .then(
                (t) =>
                    alive &&
                    setTpl({ name: t.name, filename: t.filename, design: t.design, portal_visible: t.portal_visible, next_number: t.next_number }),
            )
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

function DesignerBody(props: DocumentDesignerProps & { initialTpl: TemplateDraft }): JSX.Element {
    const toast = useToast();
    const confirm = useConfirm();
    const narrow = useMediaQuery('(max-width: 1023px)');
    const save = useSaveDocumentTemplate(props.listId);
    const [templateId, setTemplateId] = useState<number | null>(props.templateId);
    const [name, setName] = useState(props.initialTpl.name);
    const [filename, setFilename] = useState(props.initialTpl.filename);
    const [portalVisible, setPortalVisible] = useState(props.initialTpl.portal_visible ?? false);
    const [nextNumber, setNextNumber] = useState<number | null>(props.initialTpl.next_number ?? null);
    const [hist, setHist] = useState<History>({ past: [], present: props.initialTpl.design, future: [], lastKey: null, lastAt: 0 });
    const design = hist.present;
    const [savedSnapshot, setSavedSnapshot] = useState(() =>
        props.templateId === null
            ? ''
            : JSON.stringify([props.initialTpl.name, props.initialTpl.filename, props.initialTpl.design, props.initialTpl.portal_visible ?? false]),
    );
    const dirty = JSON.stringify([name, filename, design, portalVisible]) !== savedSnapshot;
    const [selected, setSelected] = useState<string | null>(null);
    const [leftTab, setLeftTab] = useState<'blocks' | 'outline' | 'page'>('blocks');
    // v0.1.273 — la pestaña del panel del bloque se recuerda al cambiar de bloque.
    const [inspTab, setInspTab] = useState<InspectorTab>('content');
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
            // Con la plantilla guardada, el número de la vista previa es el
            // que llevaría (sin consumirlo): el ya emitido o el próximo.
            previewDocument(props.listId, { design, mode, record_id: recordId, template_id: templateId }, ctrl.signal)
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
    }, [design, mode, recordId, props.listId, templateId]);
    useEffect(() => () => reqRef.current?.abort(), []);

    const totalTags: MergeTagSection[] = useMemo(() => {
        const items = design.blocks
            .filter((b) => b.type === 'totals')
            .flatMap((b) => (b.type === 'totals' ? b.rows : []))
            .flatMap((r) => [
                { tag: `totales.${r.id}`, label: r.label || r.id, hint: `{{totales.${r.id}}}` },
                { tag: `totales.${r.id}|pesos|mayusculas`, label: `${r.label || r.id} · ${__('en letras')}`, hint: __('UN MILLÓN DE PESOS') },
            ]);
        const doc: MergeTagSection = {
            title: __('Documento'),
            items: [{ tag: 'documento.numero', label: __('Número del documento'), hint: __('el consecutivo: CC-0001') }],
        };
        return items.length ? [doc, { title: __('Totales del documento'), items }] : [doc];
    }, [design.blocks]);

    const selectedBlock = findDocBlock(design, selected);
    const selectedLoc = selected ? locateDocBlock(design, selected) : null;
    const blockCount = design.blocks.reduce((n, b) => n + 1 + (b.type === 'columns' ? b.columns.reduce((m, c) => m + c.blocks.length, 0) : 0), 0);

    const add = (type: DocBlockType): void => {
        const block = makeDocBlock(type);
        commit((d) => insertDocBlock(d, block, selected));
        setSelected(block.id);
        setInspTab('content');
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
            toast.error(__('Ponle un nombre a la plantilla'));
            return;
        }
        try {
            const saved = await save.mutateAsync({
                id: templateId,
                body: { name: name.trim(), filename: filename.trim(), design, portal_visible: portalVisible },
            });
            setTemplateId(saved.id);
            setNextNumber(saved.next_number);
            setSavedSnapshot(JSON.stringify([name, filename, design, portalVisible]));
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
                <TabBtn active={leftTab === 'blocks'} onClick={() => setLeftTab('blocks')} testId="doc-left-blocks">
                    {__('Agregar')}
                </TabBtn>
                <TabBtn active={leftTab === 'outline'} onClick={() => setLeftTab('outline')} testId="doc-left-outline">
                    {__('Estructura')}
                    {blockCount > 0 && <span className="imcrm-ml-1 imcrm-rounded-full imcrm-bg-muted imcrm-px-1.5 imcrm-text-[10px] imcrm-tabular-nums">{blockCount}</span>}
                </TabBtn>
                <TabBtn active={leftTab === 'page'} onClick={() => setLeftTab('page')} testId="doc-left-page">
                    {__('Hoja y estilo')}
                </TabBtn>
            </div>
            <div className="imcrm-flex-1 imcrm-overflow-y-auto imcrm-p-3">
                {leftTab === 'blocks' ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            {selected ? __('Se agrega debajo del bloque elegido.') : __('Toca un bloque para agregarlo al final del documento.')}
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
                    </div>
                ) : leftTab === 'outline' ? (
                    <Outline design={design} selected={selected} onSelect={onSelect} onAdd={() => setLeftTab('blocks')} />
                ) : (
                    <PagePanel
                        design={design}
                        fields={props.fields}
                        filename={filename}
                        onFilename={setFilename}
                        extraTags={totalTags}
                        onTheme={(theme, key) => commit((d) => ({ ...d, theme: { ...d.theme, ...theme } }), key)}
                        onFooter={(footer, key) => commit((d) => ({ ...d, footer: { ...d.footer, ...footer } }), key)}
                        onNumbering={(numbering, key) => commit((d) => ({ ...d, numbering: { ...d.numbering, ...numbering } }), key)}
                        nextNumber={nextNumber}
                        portalVisible={portalVisible}
                        onPortalVisible={setPortalVisible}
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
            parent={
                selectedLoc?.parentId
                    ? {
                          label: `${__('Columnas')} · ${__('columna')} ${(selectedLoc.columnIndex ?? 0) + 1}`,
                          onSelect: () => onSelect(selectedLoc.parentId),
                      }
                    : null
            }
            tab={inspTab}
            onTab={setInspTab}
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
            {__('Toca un bloque en el documento para editarlo.')}
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
                <ThemeToggle compact />
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

function Outline({
    design,
    selected,
    onSelect,
    onAdd,
}: {
    design: DocDesign;
    selected: string | null;
    onSelect: (id: string) => void;
    onAdd: () => void;
}): JSX.Element {
    if (design.blocks.length === 0) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-py-8 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground" data-testid="doc-outline">
                {__('El documento todavía no tiene bloques.')}
                <button type="button" onClick={onAdd} className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                    {__('Agregar el primero')}
                </button>
            </div>
        );
    }
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5" data-testid="doc-outline">
            <p className="imcrm-mb-1.5 imcrm-flex imcrm-items-start imcrm-gap-1 imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                <ListOrdered className="imcrm-mt-px imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />
                {__('El orden del documento, de arriba hacia abajo. Toca un bloque para editarlo.')}
            </p>
            {design.blocks.map((b) => (
                <div key={b.id}>
                    <OutlineRow label={__(DOC_BLOCK_LABELS[b.type])} active={selected === b.id} onClick={() => onSelect(b.id)} />
                    {b.type === 'columns' &&
                        b.columns.map((c, ci) => (
                            <div key={ci} className="imcrm-ml-3 imcrm-border-l imcrm-border-border imcrm-pl-2">
                                <p className="imcrm-px-2 imcrm-py-0.5 imcrm-text-[10.5px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                    {__('Columna')} {ci + 1}
                                    {c.blocks.length === 0 && <span className="imcrm-ml-1 imcrm-normal-case imcrm-tracking-normal">· {__('vacía')}</span>}
                                </p>
                                {c.blocks.map((ib) => (
                                    <OutlineRow key={ib.id} label={__(DOC_BLOCK_LABELS[ib.type])} active={selected === ib.id} onClick={() => onSelect(ib.id)} />
                                ))}
                            </div>
                        ))}
                </div>
            ))}
        </div>
    );
}

function OutlineRow({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'imcrm-flex imcrm-w-full imcrm-items-center imcrm-rounded imcrm-px-2 imcrm-py-1 imcrm-text-left imcrm-text-xs hover:imcrm-bg-accent',
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
    onNumbering,
    nextNumber,
    portalVisible,
    onPortalVisible,
}: {
    design: DocDesign;
    fields: FieldEntity[];
    filename: string;
    onFilename: (v: string) => void;
    extraTags: MergeTagSection[];
    onTheme: (patch: Partial<DocDesign['theme']>, key: string) => void;
    onFooter: (patch: Partial<DocDesign['footer']>, key: string) => void;
    onNumbering: (patch: Partial<DocDesign['numbering']>, key: string) => void;
    nextNumber: number | null;
    portalVisible: boolean;
    onPortalVisible: (v: boolean) => void;
}): JSX.Element {
    const t = design.theme;
    const n = design.numbering;
    const textFields = fields.filter((f) => f.type === 'text' || f.type === 'long_text');
    const upcoming = formatDocNumber(Math.max(nextNumber ?? n.start, n.start), n);
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
            <Section title={__('Tipografía')}>
                <FontSelect label={__('Fuente del documento')} value={t.font} onChange={(f) => f && onTheme({ font: f }, 'font')} medium="pdf" />
                <FontSelect
                    label={__('Fuente de los títulos')}
                    value={t.heading_font ?? null}
                    onChange={(f) => onTheme({ heading_font: f }, 'heading_font')}
                    medium="pdf"
                    inheritLabel={__('La misma del documento')}
                />
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                    <NumberField
                        label={__('Tamaño del texto')}
                        unit="pt"
                        min={8}
                        max={13}
                        value={t.font_size}
                        onChange={(v) => onTheme({ font_size: v == null ? 10 : Math.round(v) }, 'font_size')}
                        placeholder="10"
                    />
                    <NumberField
                        label={__('Interlineado')}
                        min={1}
                        max={2.4}
                        step={0.1}
                        value={t.line_height}
                        onChange={(v) => onTheme({ line_height: v }, 'line_height')}
                        placeholder="1,25"
                    />
                </div>
                <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                    {__('Las fuentes van incluidas dentro del PDF: se ve igual en cualquier computador o celular, y al imprimirlo.')}
                </p>
            </Section>
            <Section title={__('Colores')}>
                <ColorField label={__('Acento (títulos, tabla, total)')} value={t.accent} onChange={(v) => v && onTheme({ accent: v }, 'accent')} allowEmpty={false} />
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                    <ColorField label={__('Texto')} value={t.text} onChange={(v) => v && onTheme({ text: v }, 'text')} allowEmpty={false} />
                    <ColorField label={__('Texto secundario')} value={t.muted} onChange={(v) => v && onTheme({ muted: v }, 'muted')} allowEmpty={false} />
                    <ColorField label={__('Líneas')} value={t.border} onChange={(v) => v && onTheme({ border: v }, 'border')} allowEmpty={false} />
                </div>
            </Section>
            <Section title={__('Pie de página')}>
                <Check label={__('Numerar las páginas («Página 1 de 2»)')} checked={design.footer.page_numbers} onChange={(v) => onFooter({ page_numbers: v }, 'page_numbers')} />
                <Field label={__('Texto del pie (opcional)')}>
                    <MergeTagInput value={design.footer.text} onChange={(v) => onFooter({ text: v }, 'footer_text')} fields={fields} tagContext="document" extraTags={extraTags} />
                </Field>
            </Section>
            <Section title={__('Numeración')}>
                <div data-testid="doc-numbering" className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    <Check
                        label={__('Numerar los documentos (consecutivo)')}
                        checked={n.enabled}
                        onChange={(v) => onNumbering({ enabled: v }, 'numbering_enabled')}
                    />
                    {n.enabled && (
                        <>
                            <div className="imcrm-grid imcrm-grid-cols-3 imcrm-gap-2">
                                <Field label={__('Prefijo')}>
                                    <Input
                                        value={n.prefix}
                                        maxLength={20}
                                        placeholder="CC-"
                                        onChange={(e) => onNumbering({ prefix: e.target.value }, 'numbering_prefix')}
                                        data-testid="doc-numbering-prefix"
                                    />
                                </Field>
                                <Field label={__('Dígitos')}>
                                    <Select value={String(n.padding)} onChange={(e) => onNumbering({ padding: Number(e.target.value) }, 'numbering_padding')}>
                                        {[0, 2, 3, 4, 5, 6, 8].map((d) => (
                                            <option key={d} value={d}>
                                                {d === 0 ? __('Sin ceros') : d}
                                            </option>
                                        ))}
                                    </Select>
                                </Field>
                                <Field label={__('Empieza en')}>
                                    <Input
                                        type="number"
                                        min={1}
                                        value={n.start}
                                        onChange={(e) => {
                                            const v = Math.max(1, Math.floor(Number(e.target.value) || 1));
                                            onNumbering({ start: v }, 'numbering_start');
                                        }}
                                        data-testid="doc-numbering-start"
                                    />
                                </Field>
                            </div>
                            <p className="imcrm-rounded-md imcrm-bg-muted/50 imcrm-p-2.5 imcrm-text-[11px] imcrm-leading-relaxed imcrm-text-muted-foreground" data-testid="doc-numbering-next">
                                {__('Próximo número')}: <strong className="imcrm-text-foreground">{upcoming}</strong>.{' '}
                                {__('Cada registro recibe SU número la primera vez que se genera el documento y lo conserva: volver a generarlo no gasta otro. La vista previa no consume números.')}
                            </p>
                            <Field label={__('Guardar el número también en un campo')} hint={__('Para verlo y filtrarlo en la lista. Tiene que ser un campo de texto.')}>
                                <Select
                                    value={n.save_field ?? ''}
                                    onChange={(e) => onNumbering({ save_field: e.target.value || null }, 'numbering_save_field')}
                                    data-testid="doc-numbering-field"
                                >
                                    <option value="">{__('No guardarlo')}</option>
                                    {textFields.map((f) => (
                                        <option key={f.id} value={f.slug}>
                                            {f.label}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {__('Para mostrarlo en el documento usa la variable')} <code className="imcrm-rounded imcrm-bg-muted imcrm-px-1">{'{{documento.numero}}'}</code>.
                            </p>
                        </>
                    )}
                </div>
            </Section>
            <Section title={__('Portal del cliente')}>
                <Check
                    label={__('Disponible en el portal del cliente')}
                    checked={portalVisible}
                    onChange={onPortalVisible}
                />
                <p className="imcrm-text-[11px] imcrm-leading-relaxed imcrm-text-muted-foreground">
                    {__('El cliente lo descarga desde su portal, siempre con los datos de SU registro. Si numera, bajarlo le asigna el número igual que generarlo aquí.')}
                </p>
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

function TabBtn({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: React.ReactNode; testId?: string }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            data-testid={testId}
            aria-pressed={active}
            className={cn(
                'imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-whitespace-nowrap imcrm-rounded-md imcrm-px-1.5 imcrm-py-1.5 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-bg-accent',
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
