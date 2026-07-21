import {
    Fragment,
    useEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from 'react';
import {
    ArrowDown,
    ArrowUp,
    Copy as CopyIcon,
    GripVertical,
    LayoutGrid,
    Plus,
    Settings2,
    X,
} from 'lucide-react';

import { blockStyleClass, blockStyleCss, readBlockStyle, wrapperStyleCss } from '@/lib/blockStyle';
import { __ } from '@/lib/i18n';
import { groupBlocksByRowsAndColumns, WIDTH_PRESETS } from '@/lib/rowsLayout';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';
import type { RecordEntity } from '@/types/record';

import { type PalettePayload, PALETTE_MIME, readDropPayload } from './dragPayload';
import {
    addSubColumn,
    deleteBlockById,
    deleteSubColumn,
    findBlockById,
    moveBlock as moveBlockNested,
    moveSubBlockWithinColumn,
    setSubColumnWidth,
    type DropTarget as NestedDropTarget,
} from './nestedHelpers';
import type { BaseTemplateBlock, BlockRegistry } from './types';

/**
 * Posición destino para crear un bloque desde la paleta.
 * Puede ser top-level (columna de una sección) o sub-columna de un
 * `nested_section`. El shell convierte esto a un `position` y crea
 * el bloque adentro.
 */
export type DropTarget = NestedDropTarget;

interface Props<TBlock extends BaseTemplateBlock> {
    listId: number;
    fields: FieldEntity[];
    blocks: TBlock[];
    record: RecordEntity | null;
    registry: BlockRegistry<TBlock>;
    selectedBlockIds: string[];
    preview?: boolean;
    onBlocksChange: (next: TBlock[]) => void;
    onSelectBlock: (id: string | null, additive?: boolean) => void;
    onDropFromPalette: (payload: PalettePayload, position: DropTarget) => void;
    onDropOnBlock: (blockId: string, payload: PalettePayload) => boolean;
}

/**
 * Editor por secciones — modelo simple y explícito (0.57.25).
 *
 * Estructura **visible** en pantalla:
 *
 *   ┌─ Sección 1 ──────────────────────────────────── × ┐
 *   │  ┌─ Col 1 · 8/12 ▾ × ┐  ┌─ Col 2 · 4/12 ▾ × ┐    │
 *   │  │  [Block A]   ↑↓×  │  │  [Block C]   ↑↓×  │    │
 *   │  │  [Block B]   ↑↓×  │  │  + Bloque         │    │
 *   │  │  + Bloque         │  └───────────────────┘    │
 *   │  └───────────────────┘                            │
 *   │  [+ Columna]                                      │
 *   └───────────────────────────────────────────────────┘
 *
 *   [+ Sección]
 *
 * Interacciones:
 *   - **Crear sección**: botón "+ Sección" abajo. Menú de presets de
 *     columnas (1, 2 mitades, 2/3+1/3, 1/3+2/3, 3 columnas, 4 columnas).
 *   - **Agregar columna a sección**: botón "+ Columna" dentro de la sección.
 *   - **Cambiar ancho de columna**: dropdown "X/12" en el header de la col.
 *   - **Eliminar sección/columna**: botón × en el header.
 *   - **Agregar bloque**: drag desde paleta a una columna. La columna
 *     entera se ilumina al hover.
 *   - **Mover bloque entre columnas**: drag handle ≡ del bloque →
 *     dropear sobre otra columna.
 *   - **Reordenar bloque dentro de su columna**: botones ↑/↓ del bloque.
 *
 * Modelo de datos: `blocks: [{ id, type, config, x, y, w, pos, h }]`.
 *   - `y` = índice de sección
 *   - `x` = índice de columna en la sección
 *   - `pos` = posición vertical en la columna
 *   - `w` = ancho de la columna (consistente para toda la columna)
 *
 * Secciones / columnas vacías:
 *   El editor mantiene un state local con la estructura (incluso
 *   columnas/secciones sin bloques). Al persistir, las vacías que
 *   no tienen al menos un bloque se descartan — el JSON guardado
 *   solo lista los bloques reales. Al recargar el editor, las
 *   vacías que no se persistieron se pierden; las secciones con
 *   al menos un bloque vuelven a aparecer con su estructura.
 */
export function GridCanvas<TBlock extends BaseTemplateBlock>({
    listId,
    fields,
    blocks,
    record,
    registry,
    selectedBlockIds,
    preview = false,
    onBlocksChange,
    onSelectBlock,
    onDropFromPalette,
    onDropOnBlock,
}: Props<TBlock>): JSX.Element {
    type Column = {
        id: string;
        width: number;
        padding?: string;
        margin?: string;
        bg?: string;
        blocks: TBlock[];
    };
    type Section = {
        id: string;
        padding?: string;
        margin?: string;
        bg?: string;
        columns: Column[];
    };

    /** Construye la estructura visible a partir de los bloques flat.
     * El spacing (padding/margin) se LEE del primer bloque de cada
     * sección/columna (consistente entre bloques hermanos). */
    const buildFromFlat = (flat: TBlock[]): Section[] => {
        const rows = groupBlocksByRowsAndColumns(flat);
        return rows.map((row, sIdx) => {
            const firstBlockOfSection = row.columns[0]?.blocks[0];
            return {
                id: `sec-${sIdx}-${row.index}`,
                padding: firstBlockOfSection?.secPadding,
                margin: firstBlockOfSection?.secMargin,
                bg: firstBlockOfSection?.secBg,
                columns: row.columns.map((col, cIdx) => {
                    const firstBlockOfCol = col.blocks[0];
                    return {
                        id: `col-${sIdx}-${cIdx}-${col.colIdx}`,
                        width: col.width,
                        padding: firstBlockOfCol?.colPadding,
                        margin: firstBlockOfCol?.colMargin,
                        bg: firstBlockOfCol?.colBg,
                        blocks: col.blocks,
                    };
                }),
            };
        });
    };

    const [sections, setSections] = useState<Section[]>(() => buildFromFlat(blocks));
    const lastFlatRef = useRef<TBlock[]>(blocks);

    // Sync externo: si los blocks vienen de un cambio externo (undo,
    // reload, etc.), re-derivamos la estructura. Si vienen de un setSections
    // → onBlocksChange propio, no re-derivamos.
    useEffect(() => {
        if (blocks === lastFlatRef.current) return;
        setSections(buildFromFlat(blocks));
        lastFlatRef.current = blocks;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [blocks]);

    /** Persiste sections → flat blocks. Las columnas/secciones vacías se descartan.
     * El spacing (padding/margin) de cada sec/col se INYECTA en cada
     * bloque hijo para que se preserve aunque no haya un "anchor". */
    const persistSections = (next: Section[]): void => {
        const flat: TBlock[] = [];
        let sIdx = 0;
        for (const section of next) {
            const nonEmptyCols = section.columns.filter((c) => c.blocks.length > 0);
            if (nonEmptyCols.length === 0) continue;
            nonEmptyCols.forEach((col, cIdx) => {
                col.blocks.forEach((block, pIdx) => {
                    flat.push({
                        ...block,
                        x: cIdx,
                        y: sIdx,
                        pos: pIdx,
                        w: col.width,
                        h: 0,
                        secPadding: section.padding,
                        secMargin: section.margin,
                        secBg: section.bg,
                        colPadding: col.padding,
                        colMargin: col.margin,
                        colBg: col.bg,
                    });
                });
            });
            sIdx += 1;
        }
        lastFlatRef.current = flat;
        setSections(next);
        onBlocksChange(flat);
    };

    /** Set sections (sin persistir — usado para cambios de estructura vacía). */
    const updateSectionsOnly = (next: Section[]): void => {
        setSections(next);
    };

    // — Mutaciones de estructura ────────────────────────────────────

    const addSection = (columnWidths: number[]): void => {
        const sec: Section = {
            id: `sec-new-${Date.now()}`,
            columns: columnWidths.map((w, i) => ({
                id: `col-new-${Date.now()}-${i}`,
                width: w,
                blocks: [],
            })),
        };
        updateSectionsOnly([...sections, sec]);
    };

    const deleteSection = (sectionId: string): void => {
        persistSections(sections.filter((s) => s.id !== sectionId));
    };

    /**
     * v0.1.94 — Duplica la sección COMPLETA (columnas + bloques, con ids
     * nuevos) y la inserta justo debajo de la original.
     */
    const duplicateSection = (sectionId: string): void => {
        const idx = sections.findIndex((s) => s.id === sectionId);
        const src = sections[idx];
        if (!src) return;
        const stamp = Date.now();
        const clone: Section = {
            ...src,
            id: `sec-dup-${stamp}`,
            columns: src.columns.map((col, cIdx) => ({
                ...col,
                id: `col-dup-${stamp}-${cIdx}`,
                blocks: col.blocks.map((block, bIdx) => ({
                    ...(JSON.parse(JSON.stringify(block)) as TBlock),
                    id: `${block.type}-dup-${stamp}-${cIdx}-${bIdx}`,
                })),
            })),
        };
        const next = [...sections];
        next.splice(idx + 1, 0, clone);
        const hasBlocks = src.columns.some((c) => c.blocks.length > 0);
        if (hasBlocks) persistSections(next);
        else updateSectionsOnly(next);
    };

    const addColumnToSection = (sectionId: string): void => {
        const next = sections.map((s) => {
            if (s.id !== sectionId) return s;
            // Por defecto, ancho de la columna nueva = lo que sobra para
            // llegar a 12, mínimo 3.
            const used = s.columns.reduce((sum, c) => sum + c.width, 0);
            const remaining = Math.max(3, 12 - used);
            return {
                ...s,
                columns: [
                    ...s.columns,
                    {
                        id: `col-new-${Date.now()}`,
                        width: Math.min(12, remaining),
                        blocks: [],
                    },
                ],
            };
        });
        const persist = next.some(
            (s) => s.id === sectionId && s.columns.some((c) => c.blocks.length > 0),
        );
        if (persist) persistSections(next);
        else updateSectionsOnly(next);
    };

    const deleteColumn = (sectionId: string, columnId: string): void => {
        const next = sections.map((s) => {
            if (s.id !== sectionId) return s;
            return { ...s, columns: s.columns.filter((c) => c.id !== columnId) };
        });
        persistSections(next);
    };

    const setColumnWidth = (sectionId: string, columnId: string, width: number): void => {
        const next = sections.map((s) => {
            if (s.id !== sectionId) return s;
            return {
                ...s,
                columns: s.columns.map((c) =>
                    c.id === columnId ? { ...c, width: clampWidth(width) } : c,
                ),
            };
        });
        // Persistir solo si la columna tiene bloques (sino es vacía y
        // no se serializa al flat).
        const col = next
            .find((s) => s.id === sectionId)?.columns
            .find((c) => c.id === columnId);
        if (col && col.blocks.length > 0) persistSections(next);
        else updateSectionsOnly(next);
    };

    // — Mutaciones de bloques ───────────────────────────────────────

    /** Mueve un bloque a otra columna (al final). */
    const moveBlockToColumn = (blockId: string, targetSection: string, targetColumn: string): void => {
        let movedBlock: TBlock | null = null;
        const stripped = sections.map((s) => ({
            ...s,
            columns: s.columns.map((c) => ({
                ...c,
                blocks: c.blocks.filter((b) => {
                    if (b.id === blockId) {
                        movedBlock = b;
                        return false;
                    }
                    return true;
                }),
            })),
        }));
        if (! movedBlock) return;
        const next = stripped.map((s) => {
            if (s.id !== targetSection) return s;
            return {
                ...s,
                columns: s.columns.map((c) =>
                    c.id === targetColumn
                        ? { ...c, blocks: [...c.blocks, movedBlock as TBlock] }
                        : c,
                ),
            };
        });
        persistSections(next);
    };

    /** Reordena un bloque dentro de su columna (+1 o -1). */
    const reorderBlockInColumn = (
        sectionId: string,
        columnId: string,
        blockId: string,
        direction: -1 | 1,
    ): void => {
        const next = sections.map((s) => {
            if (s.id !== sectionId) return s;
            return {
                ...s,
                columns: s.columns.map((c) => {
                    if (c.id !== columnId) return c;
                    const idx = c.blocks.findIndex((b) => b.id === blockId);
                    if (idx < 0) return c;
                    const newIdx = idx + direction;
                    if (newIdx < 0 || newIdx >= c.blocks.length) return c;
                    const arr = [...c.blocks];
                    const [removed] = arr.splice(idx, 1);
                    arr.splice(newIdx, 0, removed!);
                    return { ...c, blocks: arr };
                }),
            };
        });
        persistSections(next);
    };

    const deleteBlock = (sectionId: string, columnId: string, blockId: string): void => {
        const next = sections.map((s) => {
            if (s.id !== sectionId) return s;
            return {
                ...s,
                columns: s.columns.map((c) =>
                    c.id === columnId
                        ? { ...c, blocks: c.blocks.filter((b) => b.id !== blockId) }
                        : c,
                ),
            };
        });
        persistSections(next);
    };

    // — Drop desde paleta o move externo ────────────────────────────

    const draggedBlockId = useRef<string | null>(null);
    const [dropTargetColId, setDropTargetColId] = useState<string | null>(null);

    const handleColumnDragOver = (colId: string) => (e: React.DragEvent): void => {
        const types = Array.from(e.dataTransfer.types);
        if (! types.includes(PALETTE_MIME) && draggedBlockId.current === null) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = draggedBlockId.current ? 'move' : 'copy';
        setDropTargetColId(colId);
    };

    const handleColumnDragLeave = (e: React.DragEvent): void => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropTargetColId(null);
    };

    const handleColumnDrop = (sectionId: string, colId: string) =>
        (e: React.DragEvent): void => {
            e.preventDefault();
            e.stopPropagation();
            setDropTargetColId(null);

            // Caso 1: drop interno (mover bloque). El source puede ser
            // un block top-level o un sub-bloque adentro de un
            // nested_section — distinguimos con findBlockById.
            const internalId = draggedBlockId.current;
            if (internalId) {
                draggedBlockId.current = null;
                const found = findBlockById(blocks, internalId);
                if (! found) return;
                if (found.path.kind === 'top') {
                    // Mover entre columnas top-level — usa el state local.
                    moveBlockToColumn(internalId, sectionId, colId);
                    return;
                }
                // Sub → Top: extraer del nested_section e insertar en
                // la columna top-level destino. Calculamos las coords
                // físicas a partir del index de la sección/columna
                // visible (que coincide con y/x persistidos al
                // re-derivar).
                const sIdx = sections.findIndex((s) => s.id === sectionId);
                const sec = sections[sIdx];
                if (! sec) return;
                const cIdx = sec.columns.findIndex((c) => c.id === colId);
                const col = sec.columns[cIdx];
                if (! col || cIdx < 0) return;
                const next = moveBlockNested<TBlock>(blocks, internalId, {
                    kind: 'top',
                    y: sIdx,
                    x: cIdx,
                    pos: col.blocks.length,
                });
                if (next) onBlocksChange(next);
                return;
            }

            // Caso 2: drop desde la paleta.
            const payload = readDropPayload(e);
            if (! payload) return;

            // Calcular position destino: (y=sIdx, x=cIdx, pos=blocks.length).
            const sIdx = sections.findIndex((s) => s.id === sectionId);
            const sec = sections[sIdx];
            if (! sec) return;
            const cIdx = sec.columns.findIndex((c) => c.id === colId);
            const col = sec.columns[cIdx];
            if (! col) return;

            // Si la sección destino es la última sin bloques persistidos,
            // su `y` real al persistir será el índice consecutivo final.
            // Simplificamos: pasamos el índice físico actual; el shell se
            // encarga de invocar `createBlock` y nosotros recibimos el
            // bloque nuevo via `blocks` prop → re-derivamos sections.
            onDropFromPalette(payload, {
                kind: 'top',
                x: cIdx,
                y: sIdx,
                pos: col.blocks.length,
            });
        };

    const handleBlockDragStart = (blockId: string) => (e: React.DragEvent): void => {
        draggedBlockId.current = blockId;
        e.dataTransfer.effectAllowed = 'move';
        // Sin dataTransfer.setData — algunos browsers requieren un valor.
        e.dataTransfer.setData('text/plain', blockId);
    };

    const handleBlockDragEnd = (): void => {
        draggedBlockId.current = null;
        setDropTargetColId(null);
    };

    // — Drop sobre un bloque concreto (drop de field sobre properties_group) ─

    const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);

    const handleBlockDragOver = (blockId: string) => (e: React.DragEvent): void => {
        const types = Array.from(e.dataTransfer.types);
        // Solo PALETA — los moves internos van a column-level.
        if (! types.includes(PALETTE_MIME)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        setHoveredBlockId(blockId);
    };

    const handleBlockDragLeave = (e: React.DragEvent): void => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setHoveredBlockId(null);
    };

    const handleBlockDrop = (blockId: string) => (e: React.DragEvent): void => {
        const payload = readDropPayload(e);
        setHoveredBlockId(null);
        if (! payload) return;
        const handled = onDropOnBlock(blockId, payload);
        if (handled) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    // — Render ──────────────────────────────────────────────────────

    const ctx = { listId, fields, record };
    const selectedSet = new Set(selectedBlockIds);
    const isEmpty = sections.length === 0;

    return (
        <div
            className={cn(
                'imcrm-relative imcrm-flex imcrm-flex-col imcrm-gap-3',
                // El tinte/padding del lienzo es chrome de EDICIÓN — en
                // preview el fondo lo pone la página (WYSIWYG).
                ! preview && 'imcrm-rounded-lg imcrm-bg-muted/5 imcrm-p-3',
                isEmpty && 'imcrm-min-h-[280px]',
            )}
            onClick={(e) => {
                if (e.target === e.currentTarget) onSelectBlock(null);
            }}
        >
            {sections.map((section, sIdx) => (
                <SectionCard
                    key={section.id}
                    label={`${__('Sección')} ${sIdx + 1}`}
                    preview={preview}
                    padding={section.padding}
                    margin={section.margin}
                    bg={section.bg}
                    onSetPadding={(v) => {
                        const next = sections.map((s) => s.id === section.id ? { ...s, padding: v } : s);
                        const hasBlocks = section.columns.some((c) => c.blocks.length > 0);
                        if (hasBlocks) persistSections(next);
                        else updateSectionsOnly(next);
                    }}
                    onSetMargin={(v) => {
                        const next = sections.map((s) => s.id === section.id ? { ...s, margin: v } : s);
                        const hasBlocks = section.columns.some((c) => c.blocks.length > 0);
                        if (hasBlocks) persistSections(next);
                        else updateSectionsOnly(next);
                    }}
                    onSetBg={(v) => {
                        const next = sections.map((s) => s.id === section.id ? { ...s, bg: v === '' ? undefined : v } : s);
                        const hasBlocks = section.columns.some((c) => c.blocks.length > 0);
                        if (hasBlocks) persistSections(next);
                        else updateSectionsOnly(next);
                    }}
                    onDelete={() => deleteSection(section.id)}
                    onDuplicate={() => duplicateSection(section.id)}
                >
                    <div className="imcrm-flex imcrm-flex-row imcrm-gap-3">
                        {section.columns.map((col, cIdx) => (
                            <ColumnCard
                                key={col.id}
                                label={`${__('Col')} ${cIdx + 1}`}
                                width={col.width}
                                preview={preview}
                                padding={col.padding}
                                margin={col.margin}
                                bg={col.bg}
                                onSetBg={(v) => {
                                    const next = sections.map((s) => s.id === section.id ? {
                                        ...s,
                                        columns: s.columns.map((c) => c.id === col.id ? { ...c, bg: v === '' ? undefined : v } : c),
                                    } : s);
                                    if (col.blocks.length > 0) persistSections(next);
                                    else updateSectionsOnly(next);
                                }}
                                onSetPadding={(v) => {
                                    const next = sections.map((s) => s.id === section.id ? {
                                        ...s,
                                        columns: s.columns.map((c) => c.id === col.id ? { ...c, padding: v } : c),
                                    } : s);
                                    if (col.blocks.length > 0) persistSections(next);
                                    else updateSectionsOnly(next);
                                }}
                                onSetMargin={(v) => {
                                    const next = sections.map((s) => s.id === section.id ? {
                                        ...s,
                                        columns: s.columns.map((c) => c.id === col.id ? { ...c, margin: v } : c),
                                    } : s);
                                    if (col.blocks.length > 0) persistSections(next);
                                    else updateSectionsOnly(next);
                                }}
                                onSetWidth={(w) => setColumnWidth(section.id, col.id, w)}
                                onDelete={() => deleteColumn(section.id, col.id)}
                                isDropTarget={dropTargetColId === col.id}
                                onDragOver={handleColumnDragOver(col.id)}
                                onDragLeave={handleColumnDragLeave}
                                onDrop={handleColumnDrop(section.id, col.id)}
                                empty={col.blocks.length === 0}
                            >
                                {col.blocks.map((block, pIdx) => (
                                    <BlockCard
                                        key={block.id}
                                        preview={preview}
                                        selected={! preview && selectedSet.has(block.id)}
                                        isDropTarget={hoveredBlockId === block.id}
                                        canMoveUp={pIdx > 0}
                                        canMoveDown={pIdx < col.blocks.length - 1}
                                        onSelect={(e) => {
                                            if (preview) return;
                                            e.stopPropagation();
                                            onSelectBlock(block.id, e.shiftKey);
                                        }}
                                        onDragStart={handleBlockDragStart(block.id)}
                                        onDragEnd={handleBlockDragEnd}
                                        onBlockDragOver={handleBlockDragOver(block.id)}
                                        onBlockDragLeave={handleBlockDragLeave}
                                        onBlockDrop={handleBlockDrop(block.id)}
                                        onMoveUp={() =>
                                            reorderBlockInColumn(section.id, col.id, block.id, -1)
                                        }
                                        onMoveDown={() =>
                                            reorderBlockInColumn(section.id, col.id, block.id, 1)
                                        }
                                        onDelete={() =>
                                            deleteBlock(section.id, col.id, block.id)
                                        }
                                    >
                                        {block.type === 'nested_section' ? (
                                            <NestedSectionInline
                                                parent={block}
                                                blocks={blocks}
                                                registry={registry}
                                                ctx={ctx}
                                                preview={preview}
                                                selectedSet={selectedSet}
                                                dropTargetColId={dropTargetColId}
                                                draggedBlockId={draggedBlockId}
                                                onBlocksChange={onBlocksChange}
                                                onSelectBlock={onSelectBlock}
                                                onDropFromPalette={onDropFromPalette}
                                                onSetDropTarget={setDropTargetColId}
                                            />
                                        ) : (
                                            // WYSIWYG: el mismo wrapper de estilo
                                            // (config.style) que aplican la ficha
                                            // real y el portal.
                                            <div
                                                className={blockStyleClass(readBlockStyle(block.config))}
                                                style={blockStyleCss(readBlockStyle(block.config))}
                                            >
                                                {registry.renderPreview(block, ctx)}
                                            </div>
                                        )}
                                    </BlockCard>
                                ))}
                            </ColumnCard>
                        ))}
                    </div>

                    {! preview && (
                        <button
                            type="button"
                            onClick={() => addColumnToSection(section.id)}
                            className="imcrm-mt-2 imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-self-start imcrm-rounded imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-card imcrm-px-2 imcrm-py-1 imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-border-primary hover:imcrm-text-primary"
                        >
                            <Plus className="imcrm-h-3 imcrm-w-3" />
                            {__('Columna')}
                        </button>
                    )}
                </SectionCard>
            ))}

            {! preview && <AddSectionMenu onAdd={addSection} />}

            {isEmpty && ! preview && (
                <div className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-3 imcrm-flex imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-3 imcrm-rounded-md imcrm-px-6 imcrm-text-center">
                    <div className="imcrm-flex imcrm-h-12 imcrm-w-12 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted/50 imcrm-text-muted-foreground">
                        <LayoutGrid className="imcrm-h-5 imcrm-w-5" aria-hidden />
                    </div>
                    <p className="imcrm-max-w-sm imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Canvas vacío. Creá una sección abajo y arrastrá bloques desde la paleta.')}
                    </p>
                </div>
            )}
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────
// Subcomponentes
// ───────────────────────────────────────────────────────────────────

function SectionCard({
    label,
    preview,
    padding,
    margin,
    bg,
    onSetPadding,
    onSetMargin,
    onSetBg,
    onDelete,
    onDuplicate,
    children,
}: {
    label: string;
    preview: boolean;
    padding?: string;
    margin?: string;
    bg?: string;
    onSetPadding: (v: string) => void;
    onSetMargin: (v: string) => void;
    onSetBg: (v: string) => void;
    onDelete: () => void;
    onDuplicate: () => void;
    children: ReactNode;
}): JSX.Element {
    // El spacing se aplica solo en preview mode para que el editor
    // refleje el resultado final (en edición movería el cursor y el
    // drag se sentiría raro). El FONDO sí se aplica siempre — no
    // afecta la geometría y ver el color mientras editás es clave.
    //
    // v0.1.96 — en preview NO hay tarjeta de sección (borde/fondo/
    // sombra son chrome del editor): el wrapper es el MISMO
    // `wrapperStyleCss` que aplican la ficha real y el portal.
    if (preview) {
        return (
            <div style={wrapperStyleCss({ bg, padding, margin })}>
                {children}
            </div>
        );
    }
    const editStyle: CSSProperties = {};
    if (bg !== undefined && bg !== '') editStyle.backgroundColor = bg;
    return (
        <div
            className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3 imcrm-shadow-imcrm-xs"
            style={editStyle}
        >
            {! preview && (
                <div className="imcrm-mb-2 imcrm-flex imcrm-items-center imcrm-justify-between">
                    <span className="imcrm-text-[11px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {label}
                    </span>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                        <SpacingPopover
                            padding={padding}
                            margin={margin}
                            bg={bg}
                            onSetPadding={onSetPadding}
                            onSetMargin={onSetMargin}
                            onSetBg={onSetBg}
                            title={__('Estilo de la sección')}
                        />
                        <button
                            type="button"
                            onClick={onDuplicate}
                            title={__('Duplicar sección completa')}
                            className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground"
                        >
                            <CopyIcon className="imcrm-h-3.5 imcrm-w-3.5" />
                        </button>
                        <button
                            type="button"
                            onClick={onDelete}
                            title={__('Eliminar sección')}
                            className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                        >
                            <X className="imcrm-h-3.5 imcrm-w-3.5" />
                        </button>
                    </div>
                </div>
            )}
            {children}
        </div>
    );
}

interface ColumnCardProps {
    label: string;
    width: number;
    preview: boolean;
    padding?: string;
    margin?: string;
    bg?: string;
    onSetWidth: (w: number) => void;
    onSetPadding: (v: string) => void;
    onSetMargin: (v: string) => void;
    onSetBg: (v: string) => void;
    onDelete: () => void;
    isDropTarget: boolean;
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
    empty: boolean;
    children: ReactNode;
}

function ColumnCard({
    label,
    width,
    preview,
    padding,
    margin,
    bg,
    onSetWidth,
    onSetPadding,
    onSetMargin,
    onSetBg,
    onDelete,
    isDropTarget,
    onDragOver,
    onDragLeave,
    onDrop,
    empty,
    children,
}: ColumnCardProps): JSX.Element {
    // 0.57.38 — mismo modelo que el front: `flex: w w 0`. El gap entre
    // columnas lo da el row (12px); el navegador reparte el ancho
    // disponible proporcional al width sin overflow ni calc().
    const style: CSSProperties = {
        flex: `${width} ${width} 0`,
        minWidth: 0,
    };
    if (bg !== undefined && bg !== '') style.backgroundColor = bg;

    // v0.1.96 — en preview la columna es una celda LIMPIA (sin borde
    // punteado, tinte ni padding del editor), con el mismo wrapper de
    // fondo/spacing que el front real.
    if (preview) {
        return (
            <div
                style={{
                    flex: `${width} ${width} 0`,
                    minWidth: 0,
                    ...wrapperStyleCss({ bg, padding, margin }),
                }}
                className="imcrm-flex imcrm-flex-col imcrm-gap-3"
            >
                {children}
            </div>
        );
    }

    return (
        <div
            style={style}
            onDragOver={preview ? undefined : onDragOver}
            onDragLeave={preview ? undefined : onDragLeave}
            onDrop={preview ? undefined : onDrop}
            className={cn(
                'imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-p-2 imcrm-transition-all',
                isDropTarget
                    ? 'imcrm-border-primary imcrm-bg-primary/5'
                    : 'imcrm-border-border imcrm-bg-muted/10',
                empty && 'imcrm-min-h-[72px]',
            )}
        >
            {! preview && (
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-1">
                    <span className="imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {label}
                    </span>
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                        <select
                            value={width}
                            onChange={(e) => onSetWidth(Number(e.target.value))}
                            className="imcrm-h-5 imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-1 imcrm-text-[10px] focus:imcrm-outline-none focus:imcrm-ring-1 focus:imcrm-ring-primary"
                            title={__('Ancho de columna')}
                        >
                            {WIDTH_PRESETS.map((p) => (
                                <option key={p.value} value={p.value}>
                                    {p.label}
                                </option>
                            ))}
                        </select>
                        <SpacingPopover
                            padding={padding}
                            margin={margin}
                            bg={bg}
                            onSetPadding={onSetPadding}
                            onSetMargin={onSetMargin}
                            onSetBg={onSetBg}
                            title={__('Estilo de la columna')}
                            compact
                        />
                        <button
                            type="button"
                            onClick={onDelete}
                            title={__('Eliminar columna')}
                            className="imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                        >
                            <X className="imcrm-h-3 imcrm-w-3" />
                        </button>
                    </div>
                </div>
            )}

            {empty && ! preview && (
                <div className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-text-center imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Soltá un bloque acá')}
                </div>
            )}

            {children}
        </div>
    );
}

interface BlockCardProps {
    preview: boolean;
    selected: boolean;
    isDropTarget: boolean;
    canMoveUp: boolean;
    canMoveDown: boolean;
    onSelect: (e: React.MouseEvent) => void;
    onDragStart: (e: React.DragEvent) => void;
    onDragEnd: () => void;
    onBlockDragOver: (e: React.DragEvent) => void;
    onBlockDragLeave: (e: React.DragEvent) => void;
    onBlockDrop: (e: React.DragEvent) => void;
    onMoveUp: () => void;
    onMoveDown: () => void;
    onDelete: () => void;
    children: ReactNode;
}

function BlockCard({
    preview,
    selected,
    isDropTarget,
    canMoveUp,
    canMoveDown,
    onSelect,
    onDragStart,
    onDragEnd,
    onBlockDragOver,
    onBlockDragLeave,
    onBlockDrop,
    onMoveUp,
    onMoveDown,
    onDelete,
    children,
}: BlockCardProps): JSX.Element {
    // v0.1.96 — en preview el bloque se renderiza SIN chrome (ring,
    // fondo de tarjeta, cursor): igual que en la ficha/portal reales.
    if (preview) {
        return <div className="imcrm-overflow-x-auto">{children}</div>;
    }
    return (
        <div
            onClick={onSelect}
            onDragOver={onBlockDragOver}
            onDragLeave={onBlockDragLeave}
            onDrop={onBlockDrop}
            className={cn(
                'imcrm-group imcrm-relative imcrm-overflow-hidden imcrm-rounded imcrm-bg-card imcrm-ring-1 imcrm-transition-all imcrm-cursor-pointer',
                isDropTarget
                    ? 'imcrm-ring-2 imcrm-ring-primary imcrm-ring-offset-1'
                    : selected
                        ? 'imcrm-ring-2 imcrm-ring-primary'
                        : 'imcrm-ring-border hover:imcrm-ring-primary/40',
            )}
        >
            {/* Toolbar arriba con drag handle + reorder + delete. */}
            {! preview && (
                <div className="imcrm-pointer-events-none imcrm-absolute imcrm-right-1 imcrm-top-1 imcrm-z-20 imcrm-flex imcrm-items-center imcrm-gap-0.5 imcrm-rounded imcrm-bg-card/95 imcrm-px-1 imcrm-py-0.5 imcrm-opacity-0 imcrm-shadow-imcrm-sm imcrm-transition group-hover:imcrm-opacity-100">
                    <button
                        type="button"
                        draggable
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
                        title={__('Arrastrar a otra columna')}
                        onClick={(e) => e.stopPropagation()}
                        className="imcrm-pointer-events-auto imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-cursor-grab imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground active:imcrm-cursor-grabbing"
                    >
                        <GripVertical className="imcrm-h-3.5 imcrm-w-3.5" />
                    </button>
                    <BlockToolbarBtn
                        onClick={onMoveUp}
                        disabled={! canMoveUp}
                        title={__('Subir')}
                    >
                        <ArrowUp className="imcrm-h-3 imcrm-w-3" />
                    </BlockToolbarBtn>
                    <BlockToolbarBtn
                        onClick={onMoveDown}
                        disabled={! canMoveDown}
                        title={__('Bajar')}
                    >
                        <ArrowDown className="imcrm-h-3 imcrm-w-3" />
                    </BlockToolbarBtn>
                    <BlockToolbarBtn
                        onClick={onDelete}
                        title={__('Eliminar bloque')}
                        destructive
                    >
                        <X className="imcrm-h-3 imcrm-w-3" />
                    </BlockToolbarBtn>
                </div>
            )}
            <div className="imcrm-overflow-x-auto">{children}</div>
            {isDropTarget && (
                <div className="imcrm-pointer-events-none imcrm-absolute imcrm-inset-0 imcrm-z-10 imcrm-flex imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-bg-primary/10">
                    <p className="imcrm-rounded imcrm-bg-primary imcrm-px-2 imcrm-py-1 imcrm-text-[11px] imcrm-font-medium imcrm-text-primary-foreground">
                        {__('Soltar para agregar al grupo')}
                    </p>
                </div>
            )}
        </div>
    );
}

function BlockToolbarBtn({
    onClick,
    disabled,
    title,
    destructive,
    children,
}: {
    onClick: () => void;
    disabled?: boolean;
    title: string;
    destructive?: boolean;
    children: ReactNode;
}): JSX.Element {
    return (
        <button
            type="button"
            onClick={(e) => {
                e.stopPropagation();
                if (! disabled) onClick();
            }}
            disabled={disabled}
            title={title}
            className={cn(
                'imcrm-pointer-events-auto imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded',
                disabled
                    ? 'imcrm-text-muted-foreground/30'
                    : destructive
                        ? 'imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive'
                        : 'imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground',
            )}
        >
            {children}
        </button>
    );
}

// — "+ Sección" con menú de presets ─────────────────────────────────

const SECTION_PRESETS: Array<{ label: string; columns: number[] }> = [
    { label: '1 col · full',     columns: [12] },
    { label: '2 cols · 1/2 + 1/2', columns: [6, 6] },
    { label: '2 cols · 2/3 + 1/3', columns: [8, 4] },
    { label: '2 cols · 1/3 + 2/3', columns: [4, 8] },
    { label: '3 cols · 1/3 c/u',  columns: [4, 4, 4] },
    { label: '4 cols · 1/4 c/u',  columns: [3, 3, 3, 3] },
];

function AddSectionMenu({
    onAdd,
}: {
    onAdd: (columnWidths: number[]) => void;
}): JSX.Element {
    const [open, setOpen] = useState(false);
    return (
        <div className="imcrm-relative">
            <button
                type="button"
                onClick={() => setOpen(! open)}
                className="imcrm-inline-flex imcrm-w-full imcrm-items-center imcrm-justify-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-card imcrm-px-3 imcrm-py-2.5 imcrm-text-sm imcrm-font-medium imcrm-text-muted-foreground imcrm-transition hover:imcrm-border-primary hover:imcrm-text-primary"
            >
                <Plus className="imcrm-h-4 imcrm-w-4" />
                {__('Nueva sección')}
            </button>
            {open && (
                <>
                    <div
                        className="imcrm-fixed imcrm-inset-0 imcrm-z-30"
                        onClick={() => setOpen(false)}
                    />
                    <div className="imcrm-absolute imcrm-left-1/2 imcrm-top-full imcrm-z-40 imcrm-mt-1 imcrm-w-72 imcrm--translate-x-1/2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-1.5 imcrm-shadow-imcrm-md">
                        <p className="imcrm-px-2 imcrm-py-1 imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                            {__('Elegí la estructura')}
                        </p>
                        {SECTION_PRESETS.map((preset) => (
                            <button
                                key={preset.label}
                                type="button"
                                onClick={() => {
                                    onAdd(preset.columns);
                                    setOpen(false);
                                }}
                                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-text-[12px] imcrm-text-foreground hover:imcrm-bg-muted"
                            >
                                <PresetGlyph columns={preset.columns} />
                                <span>{preset.label}</span>
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

function PresetGlyph({ columns }: { columns: number[] }): JSX.Element {
    return (
        <span className="imcrm-flex imcrm-h-4 imcrm-w-12 imcrm-overflow-hidden imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-muted/30">
            {columns.map((w, i) => (
                <Fragment key={i}>
                    {i > 0 && <span className="imcrm-w-px imcrm-bg-border" />}
                    <span
                        className="imcrm-bg-muted-foreground/20"
                        style={{ flexBasis: `${(w / 12) * 100}%` }}
                    />
                </Fragment>
            ))}
        </span>
    );
}

function clampWidth(w: number): number {
    if (! Number.isFinite(w)) return 12;
    return Math.max(1, Math.min(12, Math.round(w)));
}

// ───────────────────────────────────────────────────────────────────
// NestedSectionInline — mini-editor de un nested_section dentro del canvas
// ───────────────────────────────────────────────────────────────────

interface NestedSectionInlineProps<TBlock extends BaseTemplateBlock> {
    parent: TBlock;
    blocks: TBlock[];
    registry: BlockRegistry<TBlock>;
    ctx: { listId: number; fields: FieldEntity[]; record: RecordEntity | null };
    preview: boolean;
    selectedSet: Set<string>;
    dropTargetColId: string | null;
    draggedBlockId: React.MutableRefObject<string | null>;
    onBlocksChange: (next: TBlock[]) => void;
    onSelectBlock: (id: string | null, additive?: boolean) => void;
    onDropFromPalette: (payload: PalettePayload, target: DropTarget) => void;
    onSetDropTarget: (id: string | null) => void;
}

function NestedSectionInline<TBlock extends BaseTemplateBlock>({
    parent,
    blocks,
    registry,
    ctx,
    preview,
    selectedSet,
    dropTargetColId,
    draggedBlockId,
    onBlocksChange,
    onSelectBlock,
    onDropFromPalette,
    onSetDropTarget,
}: NestedSectionInlineProps<TBlock>): JSX.Element {
    const cfg = parent.config as unknown as {
        columns: Array<{ id: string; width: number; blocks: TBlock[] }>;
    };
    const columns = Array.isArray(cfg.columns) ? cfg.columns : [];

    /** ID prefijado por parent para evitar colisiones con drop zones top-level. */
    const zId = (subColIdx: number): string => `sub:${parent.id}:${subColIdx}`;

    const handleSubColDragOver = (subColIdx: number) => (e: React.DragEvent): void => {
        const types = Array.from(e.dataTransfer.types);
        if (! types.includes(PALETTE_MIME) && draggedBlockId.current === null) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = draggedBlockId.current ? 'move' : 'copy';
        onSetDropTarget(zId(subColIdx));
    };

    const handleSubColDragLeave = (e: React.DragEvent): void => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        onSetDropTarget(null);
    };

    const handleSubColDrop = (subColIdx: number) => (e: React.DragEvent): void => {
        e.preventDefault();
        e.stopPropagation();
        onSetDropTarget(null);

        const internalId = draggedBlockId.current;
        if (internalId) {
            // Drop interno: mover el bloque (top o sub) a esta sub-columna.
            draggedBlockId.current = null;
            const targetCol = columns[subColIdx];
            if (! targetCol) return;
            // Restricción: no permitir nested_section dentro de nested_section.
            const src = findBlockById(blocks, internalId);
            if (! src) return;
            if (src.block.type === 'nested_section') return;
            const next = moveBlockNested<TBlock>(blocks, internalId, {
                kind: 'sub',
                parentId: parent.id,
                colIdx: subColIdx,
                subIdx: targetCol.blocks.length,
            });
            if (next) onBlocksChange(next);
            return;
        }

        // Drop desde paleta: crear sub-bloque nuevo en esta sub-columna.
        const payload = readDropPayload(e);
        if (! payload) return;
        const targetCol = columns[subColIdx];
        if (! targetCol) return;
        onDropFromPalette(payload, {
            kind: 'sub',
            parentId: parent.id,
            colIdx: subColIdx,
            subIdx: targetCol.blocks.length,
        });
    };

    const handleSubBlockDragStart = (subId: string) => (e: React.DragEvent): void => {
        draggedBlockId.current = subId;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', subId);
        // Detener propagación para que el drag NO se interprete como
        // drag del bloque parent (nested_section) — sino se rompe el
        // mover sub-bloques.
        e.stopPropagation();
    };

    const handleSubBlockDragEnd = (): void => {
        draggedBlockId.current = null;
        onSetDropTarget(null);
    };

    const handleAddSubColumn = (): void => {
        onBlocksChange(addSubColumn(blocks, parent.id));
    };

    const handleDeleteSubColumn = (subColIdx: number): void => {
        if (columns.length <= 1) return;
        onBlocksChange(deleteSubColumn(blocks, parent.id, subColIdx));
    };

    const handleSetSubColWidth = (subColIdx: number, width: number): void => {
        onBlocksChange(setSubColumnWidth(blocks, parent.id, subColIdx, width));
    };

    const handleMoveSubBlock = (
        subColIdx: number,
        subIdx: number,
        direction: -1 | 1,
    ): void => {
        onBlocksChange(
            moveSubBlockWithinColumn(blocks, parent.id, subColIdx, subIdx, direction),
        );
    };

    const handleDeleteSubBlock = (subId: string): void => {
        onBlocksChange(deleteBlockById(blocks, subId));
    };

    return (
        <div
            className={cn(
                'imcrm-flex imcrm-flex-col imcrm-gap-2',
                // v0.1.96 — el tinte/padding y el header "Sub-sección"
                // son chrome del editor; en preview no existen.
                ! preview && 'imcrm-rounded imcrm-bg-muted/5 imcrm-p-2',
            )}
            onClick={preview ? undefined : (e) => e.stopPropagation()}
        >
            {! preview && (
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                    <span className="imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        {__('Sub-sección')}
                    </span>
                    <button
                        type="button"
                        onClick={handleAddSubColumn}
                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] imcrm-text-muted-foreground hover:imcrm-border-primary hover:imcrm-text-primary"
                    >
                        <Plus className="imcrm-h-2.5 imcrm-w-2.5" />
                        {__('Sub-columna')}
                    </button>
                </div>
            )}

            <div className="imcrm-flex imcrm-flex-row imcrm-gap-3">
                {columns.map((col, subColIdx) => {
                    // 0.57.38 — mismo modelo `flex: w w 0` que el front.
                    const cellStyle: CSSProperties = {
                        flex: `${col.width} ${col.width} 0`,
                        minWidth: 0,
                    };
                    const isDropTarget = dropTargetColId === zId(subColIdx);
                    return (
                        <div
                            key={col.id}
                            style={cellStyle}
                            onDragOver={preview ? undefined : handleSubColDragOver(subColIdx)}
                            onDragLeave={preview ? undefined : handleSubColDragLeave}
                            onDrop={preview ? undefined : handleSubColDrop(subColIdx)}
                            className={cn(
                                'imcrm-flex imcrm-flex-col imcrm-gap-3',
                                // v0.1.96 — borde punteado/tinte solo en edición.
                                ! preview && cn(
                                    'imcrm-rounded imcrm-border imcrm-border-dashed imcrm-p-1.5 imcrm-transition-all',
                                    isDropTarget
                                        ? 'imcrm-border-primary imcrm-bg-primary/5'
                                        : 'imcrm-border-border imcrm-bg-card/60',
                                    col.blocks.length === 0 && 'imcrm-min-h-[64px]',
                                ),
                            )}
                        >
                            {! preview && (
                                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-1">
                                    <span className="imcrm-text-[9px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                        {__('Sub-col')} {subColIdx + 1}
                                    </span>
                                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                        <select
                                            value={col.width}
                                            onChange={(e) =>
                                                handleSetSubColWidth(subColIdx, Number(e.target.value))
                                            }
                                            className="imcrm-h-5 imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-1 imcrm-text-[9px]"
                                            title={__('Ancho')}
                                        >
                                            {[3, 4, 6, 8, 9, 12].map((w) => (
                                                <option key={w} value={w}>{w}/12</option>
                                            ))}
                                        </select>
                                        <button
                                            type="button"
                                            onClick={() => handleDeleteSubColumn(subColIdx)}
                                            disabled={columns.length <= 1}
                                            title={__('Eliminar sub-columna')}
                                            className="imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive disabled:imcrm-opacity-30"
                                        >
                                            <X className="imcrm-h-2.5 imcrm-w-2.5" />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {col.blocks.length === 0 && ! preview && (
                                <div className="imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-text-center imcrm-text-[10px] imcrm-text-muted-foreground">
                                    {__('Soltá un bloque acá')}
                                </div>
                            )}

                            {col.blocks.map((subBlock, subIdx) => {
                                const isSelected = ! preview && selectedSet.has(subBlock.id);
                                return (
                                    <div
                                        key={subBlock.id}
                                        onClick={(e) => {
                                            if (preview) return;
                                            e.stopPropagation();
                                            onSelectBlock(subBlock.id, e.shiftKey);
                                        }}
                                        className={cn(
                                            // v0.1.96 — ring/tarjeta solo en edición.
                                            ! preview && cn(
                                                'imcrm-group imcrm-relative imcrm-overflow-hidden imcrm-rounded imcrm-bg-card imcrm-ring-1 imcrm-transition-all imcrm-cursor-pointer',
                                                isSelected
                                                    ? 'imcrm-ring-2 imcrm-ring-primary'
                                                    : 'imcrm-ring-border hover:imcrm-ring-primary/40',
                                            ),
                                        )}
                                    >
                                        {! preview && (
                                            <div className="imcrm-pointer-events-none imcrm-absolute imcrm-right-0.5 imcrm-top-0.5 imcrm-z-20 imcrm-flex imcrm-items-center imcrm-gap-0.5 imcrm-rounded imcrm-bg-card/95 imcrm-px-0.5 imcrm-py-0.5 imcrm-opacity-0 imcrm-shadow-imcrm-sm imcrm-transition group-hover:imcrm-opacity-100">
                                                <button
                                                    type="button"
                                                    draggable
                                                    onDragStart={handleSubBlockDragStart(subBlock.id)}
                                                    onDragEnd={handleSubBlockDragEnd}
                                                    onClick={(e) => e.stopPropagation()}
                                                    title={__('Arrastrar')}
                                                    className="imcrm-pointer-events-auto imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-cursor-grab imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-muted active:imcrm-cursor-grabbing"
                                                >
                                                    <GripVertical className="imcrm-h-3 imcrm-w-3" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (subIdx > 0) handleMoveSubBlock(subColIdx, subIdx, -1);
                                                    }}
                                                    disabled={subIdx === 0}
                                                    title={__('Subir')}
                                                    className="imcrm-pointer-events-auto imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-muted disabled:imcrm-opacity-30"
                                                >
                                                    <ArrowUp className="imcrm-h-3 imcrm-w-3" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (subIdx < col.blocks.length - 1) handleMoveSubBlock(subColIdx, subIdx, 1);
                                                    }}
                                                    disabled={subIdx === col.blocks.length - 1}
                                                    title={__('Bajar')}
                                                    className="imcrm-pointer-events-auto imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-muted disabled:imcrm-opacity-30"
                                                >
                                                    <ArrowDown className="imcrm-h-3 imcrm-w-3" />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeleteSubBlock(subBlock.id);
                                                    }}
                                                    title={__('Eliminar')}
                                                    className="imcrm-pointer-events-auto imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                                                >
                                                    <X className="imcrm-h-3 imcrm-w-3" />
                                                </button>
                                            </div>
                                        )}
                                        <div
                                            className={`imcrm-overflow-x-auto ${blockStyleClass(readBlockStyle(subBlock.config))}`}
                                            style={blockStyleCss(readBlockStyle(subBlock.config))}
                                        >
                                            {registry.renderPreview(subBlock, ctx)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// ───────────────────────────────────────────────────────────────────
// SpacingPopover — input compacto para padding/margin de sec/col
// ───────────────────────────────────────────────────────────────────

const SECTION_BG_SWATCHES = [
    '#ffffff', '#f8fafc', '#f1f5f9', '#eff6ff', '#ecfdf5',
    '#fefce8', '#fef2f2', '#faf5ff', '#0f172a', '#1e293b',
];

function SpacingPopover({
    padding,
    margin,
    bg,
    onSetPadding,
    onSetMargin,
    onSetBg,
    title,
    compact,
}: {
    padding?: string;
    margin?: string;
    bg?: string;
    onSetPadding: (v: string) => void;
    onSetMargin: (v: string) => void;
    onSetBg: (v: string) => void;
    title: string;
    compact?: boolean;
}): JSX.Element {
    const [open, setOpen] = useState(false);
    const hasSpacing =
        (padding && padding.trim() !== '') ||
        (margin && margin.trim() !== '') ||
        (bg && bg.trim() !== '');
    return (
        <div className="imcrm-relative">
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen(! open);
                }}
                title={title}
                className={cn(
                    compact ? 'imcrm-h-5 imcrm-w-5' : 'imcrm-h-6 imcrm-w-6',
                    'imcrm-flex imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-transition',
                    hasSpacing
                        ? 'imcrm-text-primary hover:imcrm-bg-primary/10'
                        : 'imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground',
                )}
            >
                <Settings2 className={compact ? 'imcrm-h-3 imcrm-w-3' : 'imcrm-h-3.5 imcrm-w-3.5'} />
            </button>
            {open && (
                <>
                    <div className="imcrm-fixed imcrm-inset-0 imcrm-z-30" onClick={() => setOpen(false)} />
                    <div className="imcrm-absolute imcrm-right-0 imcrm-top-full imcrm-z-40 imcrm-mt-1 imcrm-w-56 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2 imcrm-shadow-imcrm-md">
                        <p className="imcrm-mb-1.5 imcrm-text-[10px] imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                            {title}
                        </p>
                        <label className="imcrm-mb-1.5 imcrm-block imcrm-text-[10px] imcrm-text-muted-foreground">
                            {__('Padding')}
                            <input
                                type="text"
                                value={padding ?? ''}
                                onChange={(e) => onSetPadding(e.target.value)}
                                placeholder="1rem · 8px 16px · 0"
                                className="imcrm-mt-0.5 imcrm-block imcrm-w-full imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-1.5 imcrm-py-1 imcrm-text-[11px] imcrm-text-foreground focus:imcrm-outline-none focus:imcrm-ring-1 focus:imcrm-ring-primary"
                            />
                        </label>
                        <label className="imcrm-block imcrm-text-[10px] imcrm-text-muted-foreground">
                            {__('Margin')}
                            <input
                                type="text"
                                value={margin ?? ''}
                                onChange={(e) => onSetMargin(e.target.value)}
                                placeholder="0 · 1rem auto · 8px 0"
                                className="imcrm-mt-0.5 imcrm-block imcrm-w-full imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-1.5 imcrm-py-1 imcrm-text-[11px] imcrm-text-foreground focus:imcrm-outline-none focus:imcrm-ring-1 focus:imcrm-ring-primary"
                            />
                        </label>
                        <div className="imcrm-mt-1.5 imcrm-block imcrm-text-[10px] imcrm-text-muted-foreground">
                            {__('Fondo')}
                            <div className="imcrm-mt-1 imcrm-flex imcrm-items-center imcrm-gap-1">
                                {SECTION_BG_SWATCHES.map((hex) => (
                                    <button
                                        key={hex}
                                        type="button"
                                        aria-label={hex}
                                        title={hex}
                                        onClick={() => onSetBg(hex)}
                                        className={cn(
                                            'imcrm-h-4 imcrm-w-4 imcrm-rounded imcrm-border imcrm-transition-transform hover:imcrm-scale-110',
                                            bg === hex
                                                ? 'imcrm-border-primary imcrm-ring-1 imcrm-ring-primary/50'
                                                : 'imcrm-border-border',
                                        )}
                                        style={{ backgroundColor: hex }}
                                    />
                                ))}
                                {bg !== undefined && bg !== '' && (
                                    <button
                                        type="button"
                                        onClick={() => onSetBg('')}
                                        className="imcrm-ml-1 imcrm-text-[10px] imcrm-text-muted-foreground hover:imcrm-text-destructive"
                                    >
                                        {__('Quitar')}
                                    </button>
                                )}
                            </div>
                            <input
                                type="text"
                                value={bg ?? ''}
                                onChange={(e) => {
                                    const raw = e.target.value.trim();
                                    if (raw === '') {
                                        onSetBg('');
                                        return;
                                    }
                                    const hex = raw.startsWith('#') ? raw : `#${raw}`;
                                    if (/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) onSetBg(hex.toLowerCase());
                                }}
                                placeholder="#hex"
                                className="imcrm-mt-1 imcrm-block imcrm-w-24 imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-1.5 imcrm-py-1 imcrm-font-mono imcrm-text-[11px] imcrm-text-foreground focus:imcrm-outline-none focus:imcrm-ring-1 focus:imcrm-ring-primary"
                            />
                        </div>
                        <p className="imcrm-mt-1.5 imcrm-text-[10px] imcrm-text-muted-foreground">
                            {__('Padding/margin aceptan cualquier valor CSS. Vacío = sin estilo.')}
                        </p>
                    </div>
                </>
            )}
        </div>
    );
}
