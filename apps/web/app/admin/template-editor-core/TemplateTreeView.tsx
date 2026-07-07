import { useState, type ReactNode } from 'react';
import {
    ChevronDown,
    ChevronRight,
    Columns,
    GripVertical,
    Rows,
    Square,
} from 'lucide-react';

import { __ } from '@/lib/i18n';
import { groupBlocksByRowsAndColumns } from '@/lib/rowsLayout';
import { cn } from '@/lib/utils';

import type { BaseTemplateBlock, BlockRegistry } from './types';

interface Props<TBlock extends BaseTemplateBlock> {
    blocks: TBlock[];
    selectedBlockIds: string[];
    registry: BlockRegistry<TBlock>;
    onSelectBlock: (id: string | null) => void;
    /**
     * Mueve un bloque a la columna destino (al final de esa columna).
     * El shell se encarga de recompactar y reasignar índices.
     */
    onMoveBlockToColumn: (blockId: string, targetY: number, targetX: number) => void;
}

/**
 * Vista de árbol de la estructura del template — secciones → columnas → bloques.
 *
 * Permite:
 *  - Click en un bloque → lo selecciona en el canvas (sincronizado).
 *  - Drag un bloque → soltar sobre otra columna del árbol para moverlo.
 *  - Expandir / contraer secciones y columnas.
 *
 * Las secciones / columnas vacías que viven solo en el state interno
 * del canvas NO aparecen acá — el árbol se deriva de `blocks` flat.
 * Cuando una columna vacía recibe su primer bloque, aparece en el árbol.
 */
export function TemplateTreeView<TBlock extends BaseTemplateBlock>({
    blocks,
    selectedBlockIds,
    registry,
    onSelectBlock,
    onMoveBlockToColumn,
}: Props<TBlock>): JSX.Element {
    const sections = groupBlocksByRowsAndColumns(blocks);
    const selectedSet = new Set(selectedBlockIds);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

    const toggle = (id: string): void => {
        setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    if (sections.length === 0) {
        return (
            <div className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/10 imcrm-px-3 imcrm-py-4 imcrm-text-center imcrm-text-[11px] imcrm-text-muted-foreground">
                {__('Sin bloques. Creá una sección desde el canvas.')}
            </div>
        );
    }

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-1.5 imcrm-text-[12px]">
            {sections.map((section, sIdx) => {
                const secId = `s-${section.index}`;
                const secCollapsed = collapsed.has(secId);
                return (
                    <div key={secId}>
                        <TreeRow
                            depth={0}
                            collapsible
                            collapsed={secCollapsed}
                            onToggle={() => toggle(secId)}
                            icon={<Rows className="imcrm-h-3 imcrm-w-3" />}
                            label={`${__('Sección')} ${sIdx + 1}`}
                            badge={`${section.columns.length} ${section.columns.length === 1 ? __('col') : __('cols')}`}
                        />
                        {! secCollapsed && section.columns.map((col, cIdx) => {
                            const colId = `c-${section.index}-${col.colIdx}`;
                            const colCollapsed = collapsed.has(colId);
                            return (
                                <div key={colId}>
                                    <TreeRow
                                        depth={1}
                                        collapsible
                                        collapsed={colCollapsed}
                                        onToggle={() => toggle(colId)}
                                        icon={<Columns className="imcrm-h-3 imcrm-w-3" />}
                                        label={`${__('Col')} ${cIdx + 1}`}
                                        badge={`${col.width}/12`}
                                        droppable
                                        onDragOver={(e) => {
                                            const types = Array.from(e.dataTransfer.types);
                                            if (! types.includes('text/x-imcrm-tree-block')) return;
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = 'move';
                                        }}
                                        onDrop={(e) => {
                                            const id = e.dataTransfer.getData('text/x-imcrm-tree-block');
                                            if (! id) return;
                                            e.preventDefault();
                                            // Targets son los ÍNDICES en sections derivado, no los `y/x` físicos.
                                            // El shell resuelve a (y=sIdx, x=cIdx).
                                            onMoveBlockToColumn(id, sIdx, cIdx);
                                        }}
                                    />
                                    {! colCollapsed && col.blocks.map((block) => {
                                        const label = blockLabel(block, registry);
                                        const selected = selectedSet.has(block.id);
                                        return (
                                            <TreeRow
                                                key={block.id}
                                                depth={2}
                                                icon={<Square className="imcrm-h-3 imcrm-w-3" />}
                                                label={label}
                                                selected={selected}
                                                onClick={() => onSelectBlock(block.id)}
                                                draggable
                                                onDragStart={(e) => {
                                                    e.dataTransfer.setData('text/x-imcrm-tree-block', block.id);
                                                    e.dataTransfer.effectAllowed = 'move';
                                                }}
                                                showGrip
                                            />
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}

interface TreeRowProps {
    depth: 0 | 1 | 2;
    label: string;
    icon: ReactNode;
    badge?: string;
    selected?: boolean;
    collapsible?: boolean;
    collapsed?: boolean;
    onToggle?: () => void;
    onClick?: () => void;
    droppable?: boolean;
    onDragOver?: (e: React.DragEvent) => void;
    onDrop?: (e: React.DragEvent) => void;
    draggable?: boolean;
    onDragStart?: (e: React.DragEvent) => void;
    showGrip?: boolean;
}

function TreeRow({
    depth,
    label,
    icon,
    badge,
    selected,
    collapsible,
    collapsed,
    onToggle,
    onClick,
    droppable,
    onDragOver,
    onDrop,
    draggable,
    onDragStart,
    showGrip,
}: TreeRowProps): JSX.Element {
    const paddingLeft = `${depth * 0.75 + 0.25}rem`;
    return (
        <div
            draggable={draggable}
            onDragStart={onDragStart}
            onDragOver={droppable ? onDragOver : undefined}
            onDrop={droppable ? onDrop : undefined}
            onClick={onClick}
            className={cn(
                'imcrm-group imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1 imcrm-py-0.5',
                onClick && 'imcrm-cursor-pointer',
                draggable && 'imcrm-cursor-grab active:imcrm-cursor-grabbing',
                selected
                    ? 'imcrm-bg-primary/10 imcrm-text-primary'
                    : 'imcrm-text-foreground hover:imcrm-bg-muted',
            )}
            style={{ paddingLeft }}
        >
            {collapsible ? (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggle?.();
                    }}
                    className="imcrm-flex imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground hover:imcrm-text-foreground"
                >
                    {collapsed ? (
                        <ChevronRight className="imcrm-h-3 imcrm-w-3" />
                    ) : (
                        <ChevronDown className="imcrm-h-3 imcrm-w-3" />
                    )}
                </button>
            ) : (
                <span className="imcrm-w-4" />
            )}
            <span className="imcrm-flex imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-text-muted-foreground">
                {icon}
            </span>
            <span className="imcrm-flex-1 imcrm-truncate">{label}</span>
            {badge && (
                <span className="imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-py-px imcrm-text-[10px] imcrm-text-muted-foreground">
                    {badge}
                </span>
            )}
            {showGrip && (
                <GripVertical className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-muted-foreground imcrm-opacity-0 group-hover:imcrm-opacity-100" />
            )}
        </div>
    );
}

function blockLabel<TBlock extends BaseTemplateBlock>(
    block: TBlock,
    registry: BlockRegistry<TBlock>,
): string {
    // Tipo legible vía registry; si no, fallback al `type` crudo.
    const typeLabel = registry.labelForType(block.type) ?? block.type;
    // Si el block tiene un `label` o `title` en config, lo mostramos.
    const cfg = block.config as Record<string, unknown>;
    const titleField = (cfg['label'] ?? cfg['title'] ?? cfg['text']);
    if (typeof titleField === 'string' && titleField.trim() !== '') {
        return `${typeLabel} · ${titleField.slice(0, 30)}`;
    }
    return typeLabel;
}
