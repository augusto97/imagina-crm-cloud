import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    ArrowLeft,
    Eye,
    Loader2,
    Maximize2,
    Minimize2,
    Pencil,
    Redo2,
    Save,
    Undo2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useRecords } from '@/hooks/useRecords';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { RecordSelector } from '@/admin/lists/template-editor/RecordSelector';

import { BulkActionsPanel } from './BulkActionsPanel';
import {
    CollapsedPanelHandle,
    CollapsePanelButton,
    useCollapsablePanel,
} from './CollapsablePanels';
import { GridCanvas, type DropTarget } from './GridCanvas';
import { InspectorPanel } from './InspectorPanel';
import {
    deleteBlockById,
    findBlockById,
    updateBlockById,
} from './nestedHelpers';
import { PalettePanel } from './PalettePanel';
import { TemplateTreeView } from './TemplateTreeView';
import { useTemplateHistory } from './hooks/useTemplateHistory';
import { type PalettePayload } from './dragPayload';
import type { BaseTemplateBlock, BlockRegistry } from './types';

export interface TemplateEditorShellProps<TBlock extends BaseTemplateBlock> {
    /** Lista en la que se está editando — usada para record selector + preview. */
    listId: number;
    listName: string;
    listSlug: string;
    fields: FieldEntity[];
    /** Block registry específico del consumidor (CRM o portal). */
    registry: BlockRegistry<TBlock>;
    /** Estado inicial de bloques (cargado desde settings). */
    initialBlocks: TBlock[];
    /** Callback cuando el usuario clickea Guardar. */
    onSave: (blocks: TBlock[]) => Promise<void> | void;
    /** Si está pendiente la mutation de guardado. */
    saving?: boolean;

    /** Header copy customizable. */
    headerIcon: LucideIcon;
    headerTitle: string;
    /** A dónde lleva el botón "Volver" del header. */
    backTo: string;
    /** Panel a renderear cuando no hay selección (settings, presets, etc.). Opcional. */
    emptySelectionPanel?: JSX.Element;
    /** Si el record selector / preview deben usar mocks (cuando el preview no soporta records reales). */
    disableRecordSelector?: boolean;
    /** Texto del botón de guardado. Default: "Guardar plantilla". */
    saveLabel?: string;
    /** Controles extra en la toolbar (antes de Guardar) — ej. ajustes de página. */
    toolbarExtra?: JSX.Element;
}

/**
 * Shell genérico del editor de plantillas. Reutilizable entre CRM
 * y portal (y futuros editores de bloques en grid 12-col).
 *
 * Maneja:
 *  - Toolbar (undo/redo + RecordSelector + Editor/Preview + fullscreen + save)
 *  - Layout 3 columnas (paleta / canvas / inspector)
 *  - Selección single + multi (shift-click)
 *  - Drag-from-palette al canvas (drop libre o sobre bloque)
 *  - Bulk actions cuando hay 2+ seleccionados
 *  - Hotkeys (Cmd+S, Cmd+Z, Cmd+Y, Cmd+J, Cmd+P, Esc, ⌫, Cmd+D)
 *
 * Los bloques mismos (tipos, forms, previews) los inyecta el
 * `registry` que pasa el consumidor.
 */
export function TemplateEditorShell<TBlock extends BaseTemplateBlock>({
    listId,
    listName,
    listSlug,
    fields,
    registry,
    initialBlocks,
    onSave,
    saving = false,
    headerIcon: HeaderIcon,
    headerTitle,
    backTo,
    emptySelectionPanel,
    disableRecordSelector = false,
    saveLabel,
    toolbarExtra,
}: TemplateEditorShellProps<TBlock>): JSX.Element {
    const toast = useToast();
    const confirm = useConfirm();

    const {
        config: blocks,
        setConfig: setBlocks,
        undo,
        redo,
        canUndo,
        canRedo,
    } = useTemplateHistory<TBlock[]>(initialBlocks);

    const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);

    // Estado collapsed de los paneles laterales. Persistido en
    // localStorage para que el editor recuerde la preferencia entre
    // sesiones. Las storage keys son compartidas con el editor de
    // CRM (TemplateEditorPage) — al usuario le importa una sola
    // preferencia de layout, no una por editor.
    const [paletteCollapsed, setPaletteCollapsed] = useCollapsablePanel(
        'imcrm:editor:palette-collapsed',
    );
    const [inspectorCollapsed, setInspectorCollapsed] = useCollapsablePanel(
        'imcrm:editor:inspector-collapsed',
    );
    const [preview, setPreview] = useState(false);
    const [fullScreen, setFullScreen] = useState(false);
    const [previewRecord, setPreviewRecord] = useState<RecordEntity | null>(null);
    /** Tab activo del panel izquierdo: paleta de bloques o tree view de la estructura. */
    const [leftPanelTab, setLeftPanelTab] = useState<'palette' | 'structure'>('palette');

    // Sample real para preview cuando se elige "Datos reales".
    const sample = useRecords(listId, { per_page: 1, page: 1 });
    const sampleRecord: RecordEntity | null = sample.data?.data[0] ?? null;
    const effectiveRecord = previewRecord ?? sampleRecord;

    // Body class para chrome de WP en full-screen.
    useEffect(() => {
        if (! fullScreen) return;
        document.body.classList.add('imcrm-template-editor-fullscreen');
        return () => {
            document.body.classList.remove('imcrm-template-editor-fullscreen');
        };
    }, [fullScreen]);

    // ─── Operaciones sobre bloques ───────────────────────────────────

    const handleSave = async (): Promise<void> => {
        try {
            await onSave(blocks);
            toast.success(__('Plantilla guardada'));
        } catch (err) {
            const msg = err instanceof Error ? err.message : __('Error desconocido');
            toast.error(__('No se pudo guardar'), msg);
        }
    };

    /** Posición de "append al final": una fila nueva al final del canvas. */
    const appendPosition = (): { x: number; y: number; pos: number } => {
        const maxY = blocks.reduce((m, b) => Math.max(m, b.y ?? 0), -1);
        return { x: 0, y: maxY + 1, pos: 0 };
    };

    const handleAddBlock = (
        type: string,
        position: { x: number; y: number; pos: number },
        baseBlocks: TBlock[],
    ): void => {
        const created = registry.createBlock(type, baseBlocks, { fields }, position);
        if (! created) {
            const msg = registry.createBlockErrorMessage?.(type, { fields })
                ?? __('No se pudo crear el bloque.');
            toast.warning(msg);
            return;
        }
        setBlocks([...baseBlocks, created]);
        setSelectedBlockIds([created.id]);
    };

    const handleAddField = (
        slug: string,
        position: { x: number; y: number; pos: number },
        baseBlocks: TBlock[],
    ): void => {
        if (! registry.fieldAsBlock) return;
        const field = fields.find((f) => f.slug === slug);
        if (! field) {
            toast.error(__('Campo no encontrado.'));
            return;
        }
        const created = registry.fieldAsBlock.createBlock(field, baseBlocks, position);
        if (! created) return;
        setBlocks([...baseBlocks, created]);
        setSelectedBlockIds([created.id]);
    };

    /**
     * Drop desde la paleta. `target` puede ser top-level
     * (`{kind:'top', x, y, pos}`) o una sub-columna de un
     * `nested_section` (`{kind:'sub', parentId, colIdx, subIdx}`).
     */
    const handleDropFromPalette = (
        payload: PalettePayload,
        target: DropTarget,
    ): void => {
        if (target.kind === 'top') {
            const base = blocks.map((b) =>
                (b.y ?? 0) === target.y
                    && (b.x ?? 0) === target.x
                    && (b.pos ?? 0) >= target.pos
                    ? { ...b, pos: (b.pos ?? 0) + 1 }
                    : b,
            ) as TBlock[];
            const position = { x: target.x, y: target.y, pos: target.pos };
            if (payload.kind === 'block-type') {
                handleAddBlock(payload.type, position, base);
                return;
            }
            if (payload.kind === 'field') {
                handleAddField(payload.slug, position, base);
            }
            return;
        }

        // target.kind === 'sub' — crear sub-bloque dentro de la columna
        // del nested_section indicado.
        const created = (() => {
            if (payload.kind === 'block-type') {
                return registry.createBlock(
                    payload.type,
                    [],
                    { fields },
                    { x: 0, y: 0, pos: 0 },
                );
            }
            if (payload.kind === 'field' && registry.fieldAsBlock) {
                const field = fields.find((f) => f.slug === payload.slug);
                if (! field) return null;
                return registry.fieldAsBlock.createBlock(field, [], { x: 0, y: 0, pos: 0 });
            }
            return null;
        })();
        if (! created) return;
        // Limpiar campos de posicionamiento — el sub-bloque vive
        // dentro del config del parent, no en el plano flat.
        const subBlock = { ...created, y: 0, x: 0, pos: 0, h: 0 } as TBlock;
        const next = blocks.map((b) => {
            if (b.id !== target.parentId) return b;
            const cfg = b.config as { columns?: Array<{ id: string; width: number; blocks: TBlock[] }> };
            if (! cfg.columns) return b;
            const newColumns = cfg.columns.map((col, cIdx) => {
                if (cIdx !== target.colIdx) return col;
                const insertAt = Math.max(0, Math.min(target.subIdx, col.blocks.length));
                const arr = [...col.blocks];
                arr.splice(insertAt, 0, subBlock);
                return { ...col, blocks: arr };
            });
            return { ...b, config: { ...(b.config as object), columns: newColumns } } as TBlock;
        });
        setBlocks(next);
        setSelectedBlockIds([subBlock.id]);
    };

    const handleDropOnBlock = (blockId: string, payload: PalettePayload): boolean => {
        if (payload.kind !== 'field') return false;
        if (! registry.fieldDrop) return false;
        const target = blocks.find((b) => b.id === blockId);
        if (! target) return false;
        const result = registry.fieldDrop.handle(target, payload.slug);
        if (! result) return false;
        if (result.alreadyPresent) {
            toast.info(__('Este campo ya está en el bloque.'));
            return true;
        }
        setBlocks(blocks.map((b) => (b.id === blockId ? result.block : b)));
        setSelectedBlockIds([blockId]);
        return true;
    };

    const handleUpdateBlock = (id: string, patch: Partial<TBlock>): void => {
        // Usa el helper recursivo para soportar también sub-bloques
        // dentro de un `nested_section`.
        setBlocks(updateBlockById(blocks, id, patch));
    };

    const handleDeleteBlocks = (ids: string[]): void => {
        let next = blocks;
        for (const id of ids) {
            next = deleteBlockById(next, id);
        }
        setBlocks(next);
        const idSet = new Set(ids);
        setSelectedBlockIds((prev) => prev.filter((id) => ! idSet.has(id)));
    };

    const handleDuplicateBlocks = (ids: string[]): void => {
        const idSet = new Set(ids);
        const toDup = blocks.filter((b) => idSet.has(b.id));
        if (toDup.length === 0) return;
        const maxY = blocks.reduce((m, b) => Math.max(m, b.y ?? 0), -1);
        let offset = 1;
        const newBlocks = toDup.map((b) => {
            const out: TBlock = {
                ...b,
                id: `${b.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                y: maxY + offset,
                x: 0,
                pos: 0,
            };
            offset += 1;
            return out;
        });
        setBlocks([...blocks, ...newBlocks]);
        setSelectedBlockIds(newBlocks.map((b) => b.id));
    };

    const handleSelectBlock = (id: string | null, additive = false): void => {
        if (id === null) {
            setSelectedBlockIds([]);
            return;
        }
        // Auto-abrir el inspector cuando el usuario clickea un bloque.
        // Si lo había colapsado para tener más espacio, igual queremos
        // que vea las opciones del bloque que acaba de seleccionar.
        // No tocamos `paletteCollapsed` — esa preferencia se respeta
        // porque seleccionar un bloque no implica querer la paleta.
        if (inspectorCollapsed) {
            setInspectorCollapsed(false);
        }
        setSelectedBlockIds((prev) => {
            if (! additive) return [id];
            return prev.includes(id) ? prev.filter((bid) => bid !== id) : [...prev, id];
        });
    };

    // ─── Hotkeys ─────────────────────────────────────────────────────

    useEffect(() => {
        const isEditable = (target: EventTarget | null): boolean => {
            if (! (target instanceof HTMLElement)) return false;
            const tag = target.tagName;
            return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
        };

        const onKeyDown = (e: KeyboardEvent): void => {
            const mod = e.metaKey || e.ctrlKey;

            if (mod && e.key.toLowerCase() === 'j' && ! isEditable(e.target)) {
                e.preventDefault();
                setFullScreen((v) => ! v);
                return;
            }
            if (e.key === 'Escape' && fullScreen && selectedBlockIds.length === 0 && ! isEditable(e.target)) {
                e.preventDefault();
                setFullScreen(false);
                return;
            }
            if (mod && e.key.toLowerCase() === 's') {
                e.preventDefault();
                void handleSave();
                return;
            }
            if (mod && ! e.shiftKey && e.key.toLowerCase() === 'z') {
                if (! isEditable(e.target)) {
                    e.preventDefault();
                    undo();
                }
                return;
            }
            if (mod && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y')) {
                if (! isEditable(e.target)) {
                    e.preventDefault();
                    redo();
                }
                return;
            }
            if (mod && e.key.toLowerCase() === 'p' && ! isEditable(e.target)) {
                e.preventDefault();
                setPreview((v) => {
                    if (! v) setSelectedBlockIds([]);
                    return ! v;
                });
                return;
            }

            // Atajos por-bloque
            if (preview || selectedBlockIds.length === 0 || isEditable(e.target)) return;

            if (mod && e.key.toLowerCase() === 'd') {
                e.preventDefault();
                handleDuplicateBlocks(selectedBlockIds);
                return;
            }
            if (e.key === 'Backspace' || e.key === 'Delete') {
                e.preventDefault();
                if (selectedBlockIds.length > 1) {
                    void confirm({
                        title: __('Eliminar bloques'),
                        description: __('Se eliminarán %d bloques.').replace('%d', String(selectedBlockIds.length)),
                        destructive: true,
                        confirmLabel: __('Eliminar'),
                    }).then((ok) => {
                        if (ok) handleDeleteBlocks(selectedBlockIds);
                    });
                } else {
                    handleDeleteBlocks(selectedBlockIds);
                }
                return;
            }
            if (e.key === 'Escape') {
                e.preventDefault();
                setSelectedBlockIds([]);
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [preview, selectedBlockIds, blocks, fullScreen]);

    // ─── Selected block resolution ────────────────────────────────────

    const selectedBlock = useMemo<TBlock | null>(
        () => {
            if (selectedBlockIds.length !== 1) return null;
            const id = selectedBlockIds[0];
            if (! id) return null;
            // findBlockById busca recursivamente — soporta sub-bloques
            // adentro de `nested_section`.
            return (findBlockById(blocks, id)?.block as TBlock | undefined) ?? null;
        },
        [selectedBlockIds, blocks],
    );

    // ─── Render ───────────────────────────────────────────────────────

    return (
        <div className="imcrm-template-editor-root imcrm-flex imcrm-h-[calc(100vh-8rem)] imcrm-min-h-[640px] imcrm-flex-col imcrm-gap-3">
            <header className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-4">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                    <Button
                        asChild
                        variant="ghost"
                        size="sm"
                        className="imcrm-gap-2 imcrm-self-start imcrm-text-muted-foreground"
                    >
                        <Link to={backTo}>
                            <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                            {listName}
                        </Link>
                    </Button>
                    <h1 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">
                        <HeaderIcon className="imcrm-h-5 imcrm-w-5 imcrm-text-primary" />
                        {headerTitle}
                    </h1>
                </div>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <div className="imcrm-flex imcrm-gap-0.5">
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={undo}
                            disabled={! canUndo || preview}
                            title={__('Deshacer (⌘Z)')}
                            aria-label={__('Deshacer')}
                            className="imcrm-h-8 imcrm-w-8 imcrm-p-0"
                        >
                            <Undo2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        </Button>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={redo}
                            disabled={! canRedo || preview}
                            title={__('Rehacer (⌘⇧Z)')}
                            aria-label={__('Rehacer')}
                            className="imcrm-h-8 imcrm-w-8 imcrm-p-0"
                        >
                            <Redo2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        </Button>
                    </div>
                    {! disableRecordSelector && (
                        <RecordSelector
                            listId={listId}
                            fields={fields}
                            value={previewRecord}
                            onChange={setPreviewRecord}
                        />
                    )}
                    <div className="imcrm-flex imcrm-rounded-md imcrm-bg-muted imcrm-p-0.5">
                        <button
                            type="button"
                            onClick={() => setPreview(false)}
                            className={cn(
                                'imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
                                ! preview
                                    ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm'
                                    : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                            )}
                        >
                            <Pencil className="imcrm-h-3 imcrm-w-3" />
                            {__('Editor')}
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setPreview(true);
                                setSelectedBlockIds([]);
                            }}
                            className={cn(
                                'imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
                                preview
                                    ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm'
                                    : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                            )}
                        >
                            <Eye className="imcrm-h-3 imcrm-w-3" />
                            {__('Preview')}
                        </button>
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setFullScreen((v) => ! v)}
                        title={fullScreen ? __('Salir de full-screen (⌘J o Esc)') : __('Full-screen (⌘J)')}
                        aria-label={fullScreen ? __('Salir de full-screen') : __('Full-screen')}
                        className="imcrm-h-8 imcrm-w-8 imcrm-p-0"
                    >
                        {fullScreen ? (
                            <Minimize2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        ) : (
                            <Maximize2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        )}
                    </Button>
                    {toolbarExtra}
                    <Button
                        size="sm"
                        className="imcrm-gap-2"
                        onClick={() => void handleSave()}
                        disabled={saving}
                        title={__('Guardar (⌘S)')}
                    >
                        {saving ? (
                            <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                        ) : (
                            <Save className="imcrm-h-3.5 imcrm-w-3.5" />
                        )}
                        {saveLabel ?? __('Guardar plantilla')}
                    </Button>
                </div>
            </header>

            <div
                className={cn(
                    'imcrm-grid imcrm-flex-1 imcrm-gap-3 imcrm-overflow-hidden',
                    // Columnas dinámicas: cuando un panel está colapsado
                    // queda un sliver de 28px (el handle de re-expansión)
                    // y el canvas crece para tomar el espacio. Cuando
                    // ambos están colapsados el canvas usa casi todo el
                    // ancho disponible.
                    preview
                        ? 'imcrm-grid-cols-1'
                        : cn(
                            'imcrm-grid-cols-[var(--imcrm-palette-w)_1fr_var(--imcrm-inspector-w)]',
                        ),
                )}
                style={
                    preview
                        ? undefined
                        : ({
                            '--imcrm-palette-w': paletteCollapsed ? '28px' : '260px',
                            '--imcrm-inspector-w': inspectorCollapsed ? '28px' : '320px',
                        } as React.CSSProperties)
                }
            >
                {! preview && (
                    paletteCollapsed ? (
                        <CollapsedPanelHandle
                            side="left"
                            label={__('Mostrar paleta')}
                            onClick={() => setPaletteCollapsed(false)}
                        />
                    ) : (
                        <aside className="imcrm-relative imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
                            <CollapsePanelButton
                                side="left"
                                label={__('Ocultar paleta')}
                                onClick={() => setPaletteCollapsed(true)}
                            />
                            {/* Tabs del panel izquierdo: Paleta vs Estructura. */}
                            <div className="imcrm-flex imcrm-shrink-0 imcrm-border-b imcrm-border-border imcrm-bg-muted/30">
                                <LeftPanelTabBtn
                                    active={leftPanelTab === 'palette'}
                                    onClick={() => setLeftPanelTab('palette')}
                                >
                                    {__('Paleta')}
                                </LeftPanelTabBtn>
                                <LeftPanelTabBtn
                                    active={leftPanelTab === 'structure'}
                                    onClick={() => setLeftPanelTab('structure')}
                                >
                                    {__('Estructura')}
                                </LeftPanelTabBtn>
                            </div>
                            <div className="imcrm-flex-1 imcrm-overflow-y-auto">
                                {leftPanelTab === 'palette' ? (
                                    <PalettePanel
                                        registry={registry}
                                        existingBlocks={blocks}
                                        fields={fields}
                                        onAddBlock={(type) => handleAddBlock(type, appendPosition(), blocks)}
                                        onAddField={(slug) => handleAddField(slug, appendPosition(), blocks)}
                                    />
                                ) : (
                                    <div className="imcrm-p-2">
                                        <TemplateTreeView
                                            blocks={blocks}
                                            selectedBlockIds={selectedBlockIds}
                                            registry={registry}
                                            onSelectBlock={(id) =>
                                                setSelectedBlockIds(id !== null ? [id] : [])
                                            }
                                            onMoveBlockToColumn={(blockId, targetY, targetX) => {
                                                const blockToMove = blocks.find((b) => b.id === blockId);
                                                if (! blockToMove) return;
                                                const targetColBlocks = blocks.filter(
                                                    (b) =>
                                                        b.id !== blockId
                                                        && (b.y ?? 0) === targetY
                                                        && (b.x ?? 0) === targetX,
                                                );
                                                const targetCol = targetColBlocks[0];
                                                const newPos = targetColBlocks.length;
                                                const newW = targetCol?.w ?? blockToMove.w;
                                                const next = blocks.map((b) =>
                                                    b.id === blockId
                                                        ? { ...b, y: targetY, x: targetX, pos: newPos, w: newW }
                                                        : b,
                                                ) as TBlock[];
                                                setBlocks(next);
                                            }}
                                        />
                                    </div>
                                )}
                            </div>
                        </aside>
                    )
                )}

                <main
                    className={cn(
                        'imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3',
                        preview ? 'imcrm-bg-card' : 'imcrm-bg-background',
                    )}
                >
                    <GridCanvas
                        listId={listId}
                        fields={fields}
                        blocks={blocks}
                        record={effectiveRecord}
                        registry={registry}
                        selectedBlockIds={selectedBlockIds}
                        preview={preview}
                        onBlocksChange={setBlocks}
                        onSelectBlock={handleSelectBlock}
                        onDropFromPalette={handleDropFromPalette}
                        onDropOnBlock={handleDropOnBlock}
                    />
                </main>

                {! preview && (
                    inspectorCollapsed ? (
                        <CollapsedPanelHandle
                            side="right"
                            label={__('Mostrar opciones')}
                            onClick={() => setInspectorCollapsed(false)}
                        />
                    ) : (
                        <aside className="imcrm-relative imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
                            <CollapsePanelButton
                                side="right"
                                label={__('Ocultar opciones')}
                                onClick={() => setInspectorCollapsed(true)}
                            />
                            {selectedBlockIds.length > 1 ? (
                                <BulkActionsPanel
                                    count={selectedBlockIds.length}
                                    onDuplicate={() => handleDuplicateBlocks(selectedBlockIds)}
                                    onDelete={() => {
                                        void confirm({
                                            title: __('Eliminar bloques'),
                                            description: __('Se eliminarán %d bloques.').replace('%d', String(selectedBlockIds.length)),
                                            destructive: true,
                                            confirmLabel: __('Eliminar'),
                                        }).then((ok) => {
                                            if (ok) handleDeleteBlocks(selectedBlockIds);
                                        });
                                    }}
                                    onDeselect={() => setSelectedBlockIds([])}
                                />
                            ) : selectedBlock ? (
                                <InspectorPanel
                                    block={selectedBlock}
                                    fields={fields}
                                    registry={registry}
                                    onUpdate={(patch) => handleUpdateBlock(selectedBlock.id, patch)}
                                    onDelete={() => handleDeleteBlocks([selectedBlock.id])}
                                    onDuplicate={() => handleDuplicateBlocks([selectedBlock.id])}
                                />
                            ) : (
                                emptySelectionPanel ?? <DefaultEmptyPanel listSlug={listSlug} />
                            )}
                        </aside>
                    )
                )}
            </div>
        </div>
    );
}

function DefaultEmptyPanel({ listSlug }: { listSlug: string }): JSX.Element {
    void listSlug;
    return (
        <div className="imcrm-flex imcrm-h-full imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-px-4 imcrm-py-6 imcrm-text-center">
            <p className="imcrm-text-xs imcrm-font-medium imcrm-text-foreground">
                {__('Sin selección')}
            </p>
            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Click en un bloque del canvas para editar sus opciones, o arrastrá uno desde la paleta.')}
            </p>
        </div>
    );
}

function LeftPanelTabBtn({
    active,
    onClick,
    children,
}: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'imcrm-flex-1 imcrm-border-b-2 imcrm-px-3 imcrm-py-2 imcrm-text-[11px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-transition',
                active
                    ? 'imcrm-border-primary imcrm-bg-card imcrm-text-foreground'
                    : 'imcrm-border-transparent imcrm-text-muted-foreground hover:imcrm-text-foreground',
            )}
        >
            {children}
        </button>
    );
}
