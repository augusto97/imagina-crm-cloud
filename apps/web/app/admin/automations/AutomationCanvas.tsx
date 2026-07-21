import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, Maximize, Minus, Plus, Trash2, ZoomIn } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import {
    Sheet,
    SheetBody,
    SheetCloseButton,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
} from '@/components/ui/sheet';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ActionMeta, ActionSpec, TriggerConfig, TriggerMeta } from '@/types/automation';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';

import { ActionTypeMenu } from './ActionTypeMenu';
import {
    branchOf,
    duplicateAt,
    getNode,
    ifElseDepth,
    insertAt,
    pathKey,
    removeAt,
    updateNode,
    type NodePath,
    type SeqPath,
} from './actionsTree';
import {
    actionConditionCount,
    actionMetaFor,
    summarizeAction,
    summarizeTrigger,
    triggerMetaFor,
} from './automationMeta';
import { ConditionEditor, type ConditionRule } from './ConditionEditor';
import {
    ActionConfigEditor,
    helpForTrigger,
    TriggerConfigEditor,
} from './config-editors';

/**
 * Lienzo visual del editor de automatizaciones (v0.1.91) — vista tipo
 * n8n/Make para flujos multi-rama. A diferencia del canvas React Flow
 * eliminado en v0.1.90, este lienzo es PROPIO y con AUTO-LAYOUT: el
 * árbol (secuencias + ramas Sí/No de if_else, anidables) se posiciona
 * solo, no hay nodos que arrastrar ni desalinear, y no hay scroll — el
 * fondo se PANEA (drag / rueda) y se hace zoom (Ctrl+rueda o botones).
 *
 * Interacciones:
 *  - click en un nodo → panel lateral con SU configuración;
 *  - "+" sobre cualquier conexión → inserta una acción en esa posición
 *    exacta (incluidas las ramas);
 *  - toolbar del nodo (hover) → duplicar / eliminar;
 *  - las ramas vacías muestran un nodo fantasma "Añadir".
 */

const NODE_W = 260;
const NODE_H = 78;
const GHOST_W = 190;
const GHOST_H = 44;
const GAP_Y = 76;
const GAP_X = 56;
const MAX_IF_DEPTH = 4;

interface LNode {
    id: string;
    kind: 'trigger' | 'action' | 'ghost';
    x: number;
    y: number;
    w: number;
    h: number;
    /** Para kind=action: path del nodo. */
    path?: NodePath;
    /** Para kind=ghost: dónde inserta su click. */
    insertSeqPath?: SeqPath;
    insertIndex?: number;
    spec?: ActionSpec;
}

interface LEdge {
    id: string;
    sx: number;
    sy: number;
    tx: number;
    ty: number;
    label?: 'si' | 'no';
    insertSeqPath: SeqPath;
    insertIndex: number;
}

interface Exit {
    x: number;
    y: number;
    insertSeqPath: SeqPath;
    insertIndex: number;
    label?: 'si' | 'no';
}

interface Layout {
    nodes: LNode[];
    edges: LEdge[];
    width: number;
    height: number;
}

function widthOfSpec(spec: ActionSpec): number {
    if (spec.type !== 'if_else') return NODE_W;
    return widthOfSeq(branchOf(spec, 'then')) + GAP_X + widthOfSeq(branchOf(spec, 'else'));
}

function widthOfSeq(seq: ActionSpec[]): number {
    if (seq.length === 0) return GHOST_W;
    return Math.max(NODE_W, ...seq.map(widthOfSpec));
}

/**
 * Posiciona una secuencia centrada en `cx` a partir de `y`. `entries`
 * son los anclajes que deben conectarse con el PRIMER elemento (o con
 * lo que venga después si la secuencia está vacía). Devuelve el fondo
 * alcanzado y los anclajes de salida hacia el siguiente elemento.
 */
function layoutSeq(
    seq: ActionSpec[],
    seqPath: SeqPath,
    cx: number,
    y: number,
    entries: Exit[],
    out: Layout,
): { bottom: number; exits: Exit[] } {
    let incoming = entries;
    let cursorY = y;

    for (let i = 0; i < seq.length; i++) {
        const spec = seq[i]!;
        const nodePath: NodePath = [...seqPath, i];
        const topX = cx;
        const topY = cursorY;

        out.nodes.push({
            id: `n:${pathKey(nodePath)}`,
            kind: 'action',
            x: cx - NODE_W / 2,
            y: cursorY,
            w: NODE_W,
            h: NODE_H,
            path: nodePath,
            spec,
        });

        for (const from of incoming) {
            out.edges.push({
                id: `e:${pathKey(nodePath)}:${from.x},${from.y}`,
                sx: from.x,
                sy: from.y,
                tx: topX,
                ty: topY,
                label: from.label,
                insertSeqPath: from.insertSeqPath,
                insertIndex: from.insertIndex,
            });
        }

        const bottomAnchor = { x: cx, y: cursorY + NODE_H };

        if (spec.type === 'if_else') {
            const thenSeq = branchOf(spec, 'then');
            const elseSeq = branchOf(spec, 'else');
            const wThen = widthOfSeq(thenSeq);
            const wElse = widthOfSeq(elseSeq);
            const total = wThen + GAP_X + wElse;
            const thenCx = cx - total / 2 + wThen / 2;
            const elseCx = cx - total / 2 + wThen + GAP_X + wElse / 2;
            const childY = cursorY + NODE_H + GAP_Y;

            const branches: Array<{ key: 'then' | 'else'; seq: ActionSpec[]; cx: number; label: 'si' | 'no' }> = [
                { key: 'then', seq: thenSeq, cx: thenCx, label: 'si' },
                { key: 'else', seq: elseSeq, cx: elseCx, label: 'no' },
            ];

            let maxBottom = childY;
            const mergedExits: Exit[] = [];
            for (const b of branches) {
                const branchPath: SeqPath = [...nodePath, b.key];
                const entry: Exit = {
                    x: bottomAnchor.x,
                    y: bottomAnchor.y,
                    insertSeqPath: branchPath,
                    insertIndex: 0,
                    label: b.label,
                };
                if (b.seq.length === 0) {
                    // Rama vacía → nodo fantasma para añadir la primera acción.
                    out.nodes.push({
                        id: `g:${pathKey(branchPath)}`,
                        kind: 'ghost',
                        x: b.cx - GHOST_W / 2,
                        y: childY,
                        w: GHOST_W,
                        h: GHOST_H,
                        insertSeqPath: branchPath,
                        insertIndex: 0,
                    });
                    out.edges.push({
                        id: `e:g:${pathKey(branchPath)}`,
                        sx: bottomAnchor.x,
                        sy: bottomAnchor.y,
                        tx: b.cx,
                        ty: childY,
                        label: b.label,
                        insertSeqPath: branchPath,
                        insertIndex: 0,
                    });
                    maxBottom = Math.max(maxBottom, childY + GHOST_H);
                    // La rama vacía "cae" al siguiente paso de la secuencia padre.
                    mergedExits.push({
                        x: b.cx,
                        y: childY + GHOST_H,
                        insertSeqPath: branchPath,
                        insertIndex: 0,
                    });
                } else {
                    const res = layoutSeq(b.seq, branchPath, b.cx, childY, [entry], out);
                    maxBottom = Math.max(maxBottom, res.bottom);
                    mergedExits.push(...res.exits);
                }
            }
            cursorY = maxBottom + GAP_Y;
            incoming = mergedExits;
        } else {
            cursorY = cursorY + NODE_H + GAP_Y;
            incoming = [
                {
                    x: bottomAnchor.x,
                    y: bottomAnchor.y,
                    insertSeqPath: seqPath,
                    insertIndex: i + 1,
                },
            ];
        }
    }

    return { bottom: cursorY - GAP_Y, exits: incoming };
}

function buildLayout(actions: ActionSpec[]): Layout {
    const out: Layout = { nodes: [], edges: [], width: 0, height: 0 };
    const rootW = Math.max(widthOfSeq(actions), NODE_W);
    const cx = rootW / 2;

    // Nodo del trigger
    out.nodes.push({ id: 'trigger', kind: 'trigger', x: cx - NODE_W / 2, y: 0, w: NODE_W, h: NODE_H });
    const triggerExit: Exit = {
        x: cx,
        y: NODE_H,
        insertSeqPath: [],
        insertIndex: 0,
    };

    const res = layoutSeq(actions, [], cx, NODE_H + GAP_Y, [triggerExit], out);
    const exits = actions.length === 0 ? [triggerExit] : res.exits;
    const ghostY = (actions.length === 0 ? NODE_H : res.bottom) + GAP_Y;

    // Nodo fantasma terminal: añade al FINAL de la secuencia raíz.
    out.nodes.push({
        id: 'g:end',
        kind: 'ghost',
        x: cx - GHOST_W / 2,
        y: ghostY,
        w: GHOST_W,
        h: GHOST_H,
        insertSeqPath: [],
        insertIndex: actions.length,
    });
    for (const from of exits) {
        out.edges.push({
            id: `e:end:${from.x},${from.y}`,
            sx: from.x,
            sy: from.y,
            tx: cx,
            ty: ghostY,
            label: from.label,
            insertSeqPath: from.insertSeqPath,
            insertIndex: from.insertIndex,
        });
    }

    out.width = rootW;
    out.height = ghostY + GHOST_H;
    return out;
}

/* ── Componente principal ─────────────────────────────────────────── */

export interface AutomationCanvasProps {
    triggerType: string;
    triggerConfig: TriggerConfig;
    onTriggerTypeChange: (next: string) => void;
    onTriggerConfigChange: (next: TriggerConfig) => void;
    actions: ActionSpec[];
    onActionsChange: (next: ActionSpec[]) => void;
    triggers: TriggerMeta[];
    actionsCatalog: ActionMeta[];
    fields: FieldEntity[];
    lists: ListSummary[];
}

type Selection = { kind: 'trigger' } | { kind: 'action'; path: NodePath };

export function AutomationCanvas({
    triggerType,
    triggerConfig,
    onTriggerTypeChange,
    onTriggerConfigChange,
    actions,
    onActionsChange,
    triggers,
    actionsCatalog,
    fields,
    lists,
}: AutomationCanvasProps): JSX.Element {
    const layout = useMemo(() => buildLayout(actions), [actions]);

    const containerRef = useRef<HTMLDivElement | null>(null);
    const [view, setView] = useState({ x: 60, y: 32, z: 1 });
    const viewRef = useRef(view);
    viewRef.current = view;
    const panRef = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
    const [selected, setSelected] = useState<Selection | null>(null);

    // Si el nodo seleccionado desapareció (borrado / re-estructurado),
    // cerrar el panel — evita el "sigue saliendo una selección anterior"
    // del canvas viejo.
    useEffect(() => {
        if (selected?.kind === 'action' && getNode(actions, selected.path) === undefined) {
            setSelected(null);
        }
    }, [actions, selected]);

    const fit = (): void => {
        const el = containerRef.current;
        if (!el) return;
        const cw = el.clientWidth;
        const ch = el.clientHeight;
        const pad = 48;
        const z = Math.min((cw - pad * 2) / layout.width, (ch - pad * 2) / layout.height, 1);
        const zz = Math.max(0.3, z);
        setView({
            x: (cw - layout.width * zz) / 2,
            y: Math.max(24, (ch - layout.height * zz) / 2),
            z: zz,
        });
    };

    // Fit inicial (y cuando cambia drásticamente el tamaño del árbol).
    const fittedRef = useRef(false);
    useEffect(() => {
        if (!fittedRef.current) {
            fittedRef.current = true;
            fit();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Rueda: pan; Ctrl/⌘+rueda: zoom hacia el cursor. Listener manual
    // porque React registra wheel como passive y no deja preventDefault.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent): void => {
            e.preventDefault();
            const v = viewRef.current;
            if (e.ctrlKey || e.metaKey) {
                const rect = el.getBoundingClientRect();
                const mx = e.clientX - rect.left;
                const my = e.clientY - rect.top;
                const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
                const z = Math.min(2, Math.max(0.25, v.z * factor));
                const scale = z / v.z;
                setView({ x: mx - (mx - v.x) * scale, y: my - (my - v.y) * scale, z });
            } else {
                setView({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
            }
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []);

    const zoomBy = (factor: number): void => {
        const el = containerRef.current;
        const v = viewRef.current;
        const z = Math.min(2, Math.max(0.25, v.z * factor));
        if (!el) {
            setView({ ...v, z });
            return;
        }
        const mx = el.clientWidth / 2;
        const my = el.clientHeight / 2;
        const scale = z / v.z;
        setView({ x: mx - (mx - v.x) * scale, y: my - (my - v.y) * scale, z });
    };

    const insert = (seqPath: SeqPath, index: number, type: string): void => {
        onActionsChange(insertAt(actions, seqPath, index, { type, config: {} }));
        setSelected({ kind: 'action', path: [...seqPath, index] });
    };

    const selectedSpec =
        selected?.kind === 'action' ? getNode(actions, selected.path) : undefined;

    const triggerMeta = triggerMetaFor(triggerType);

    return (
        <>
        <div
            ref={containerRef}
            data-testid="automation-canvas"
            className="imcrm-relative imcrm-h-full imcrm-w-full imcrm-touch-none imcrm-select-none imcrm-overflow-hidden imcrm-rounded-2xl imcrm-border imcrm-border-border imcrm-bg-canvas"
            style={{
                backgroundImage: 'radial-gradient(circle, hsl(var(--imcrm-border)) 1px, transparent 1px)',
                backgroundSize: '22px 22px',
                cursor: panRef.current ? 'grabbing' : 'grab',
            }}
            onPointerDown={(e) => {
                if (e.button !== 0) return;
                // Los eventos de React burbujean por el ÁRBOL DE COMPONENTES,
                // no por el DOM: un click dentro de contenido PORTALEADO
                // (menús, popovers) llegaría acá y el setPointerCapture le
                // robaría el pointerup a ese botón (bloqueaba cerrar/chips).
                // Solo paneamos si el evento nació dentro del contenedor real.
                if (!(e.currentTarget as HTMLElement).contains(e.target as Node)) return;
                panRef.current = {
                    startX: e.clientX,
                    startY: e.clientY,
                    ox: viewRef.current.x,
                    oy: viewRef.current.y,
                };
                (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
                const p = panRef.current;
                if (!p) return;
                setView({
                    ...viewRef.current,
                    x: p.ox + (e.clientX - p.startX),
                    y: p.oy + (e.clientY - p.startY),
                });
            }}
            onPointerUp={() => {
                panRef.current = null;
            }}
        >
            {/* Mundo transformado: nodos + edges se panean/escalan juntos. */}
            <div
                className="imcrm-absolute imcrm-left-0 imcrm-top-0"
                style={{
                    transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`,
                    transformOrigin: '0 0',
                    width: layout.width,
                    height: layout.height,
                }}
            >
                <svg
                    className="imcrm-pointer-events-none imcrm-absolute imcrm-overflow-visible"
                    style={{ left: 0, top: 0, width: layout.width, height: layout.height }}
                    aria-hidden
                >
                    {layout.edges.map((e) => {
                        const d = Math.max(24, Math.min(56, (e.ty - e.sy) / 2));
                        return (
                            <path
                                key={e.id}
                                d={`M ${e.sx} ${e.sy} C ${e.sx} ${e.sy + d}, ${e.tx} ${e.ty - d}, ${e.tx} ${e.ty}`}
                                fill="none"
                                stroke="hsl(var(--imcrm-border))"
                                strokeWidth={2}
                            />
                        );
                    })}
                </svg>

                {/* Etiquetas Sí/No + botones de inserción sobre cada conexión */}
                {layout.edges.map((e) => {
                    const midX = (e.sx + e.tx) / 2;
                    const midY = (e.sy + e.ty) / 2;
                    const excludeIf = ifElseDepth(e.insertSeqPath) >= MAX_IF_DEPTH ? ['if_else'] : [];
                    return (
                        <div key={`ov:${e.id}`}>
                            {e.label && (
                                <span
                                    className={cn(
                                        'imcrm-absolute imcrm-z-10 imcrm-rounded-full imcrm-border imcrm-px-2 imcrm-py-0.5 imcrm-text-[10px] imcrm-font-bold imcrm-uppercase imcrm-tracking-wide',
                                        e.label === 'si'
                                            ? 'imcrm-border-success/30 imcrm-bg-success/10 imcrm-text-success'
                                            : 'imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-text-warning',
                                    )}
                                    style={{
                                        left: e.sx + (e.tx - e.sx) * 0.28,
                                        top: e.sy + (e.ty - e.sy) * 0.28,
                                        transform: 'translate(-50%, -50%)',
                                    }}
                                >
                                    {e.label === 'si' ? __('Sí') : __('No')}
                                </span>
                            )}
                            <div
                                className="imcrm-absolute imcrm-z-10"
                                style={{ left: midX, top: midY, transform: 'translate(-50%, -50%)' }}
                                onPointerDown={(ev) => ev.stopPropagation()}
                            >
                                <ActionTypeMenu
                                    actionsCatalog={actionsCatalog}
                                    exclude={excludeIf}
                                    onPick={(type) => insert(e.insertSeqPath, e.insertIndex, type)}
                                >
                                    <button
                                        type="button"
                                        className="imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-card imcrm-text-muted-foreground imcrm-opacity-70 imcrm-shadow-imcrm-sm imcrm-transition hover:imcrm-scale-125 hover:imcrm-border-primary/50 hover:imcrm-text-primary hover:imcrm-opacity-100"
                                        aria-label={__('Insertar acción aquí')}
                                        title={__('Insertar acción aquí')}
                                    >
                                        <Plus className="imcrm-h-3 imcrm-w-3" />
                                    </button>
                                </ActionTypeMenu>
                            </div>
                        </div>
                    );
                })}

                {/* Nodos */}
                {layout.nodes.map((n) => {
                    if (n.kind === 'trigger') {
                        return (
                            <CanvasNode
                                key={n.id}
                                node={n}
                                tone="primary"
                                overline={__('Cuando')}
                                icon={<triggerMeta.icon className="imcrm-h-4 imcrm-w-4" />}
                                title={summarizeTrigger(triggerType, triggerConfig, fields)}
                                selected={selected?.kind === 'trigger'}
                                onSelect={() => setSelected({ kind: 'trigger' })}
                            />
                        );
                    }
                    if (n.kind === 'ghost') {
                        const excludeIf = ifElseDepth(n.insertSeqPath ?? []) >= MAX_IF_DEPTH ? ['if_else'] : [];
                        return (
                            <div
                                key={n.id}
                                className="imcrm-absolute"
                                style={{ left: n.x, top: n.y, width: n.w, height: n.h }}
                                onPointerDown={(ev) => ev.stopPropagation()}
                            >
                                <ActionTypeMenu
                                    actionsCatalog={actionsCatalog}
                                    exclude={excludeIf}
                                    onPick={(type) => insert(n.insertSeqPath ?? [], n.insertIndex ?? 0, type)}
                                >
                                    <button
                                        type="button"
                                        className="imcrm-flex imcrm-h-full imcrm-w-full imcrm-items-center imcrm-justify-center imcrm-gap-1.5 imcrm-rounded-xl imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-card/60 imcrm-text-[12px] imcrm-font-medium imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-border-primary/50 hover:imcrm-text-primary"
                                    >
                                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                        {__('Añadir')}
                                    </button>
                                </ActionTypeMenu>
                            </div>
                        );
                    }
                    const spec = n.spec!;
                    const meta = actionMetaFor(spec.type);
                    const isIf = spec.type === 'if_else';
                    const condCount = actionConditionCount(spec);
                    return (
                        <CanvasNode
                            key={n.id}
                            node={n}
                            tone={isIf ? 'branch' : 'neutral'}
                            overline={isIf ? __('Condición') : __(meta.title)}
                            icon={<meta.icon className="imcrm-h-4 imcrm-w-4" />}
                            title={summarizeAction(spec, fields, lists)}
                            badge={condCount > 0 ? sprintf(__('%d cond.'), condCount) : undefined}
                            selected={
                                selected?.kind === 'action' && pathKey(selected.path) === pathKey(n.path!)
                            }
                            onSelect={() => setSelected({ kind: 'action', path: n.path! })}
                            onDuplicate={() => onActionsChange(duplicateAt(actions, n.path!))}
                            onDelete={() => onActionsChange(removeAt(actions, n.path!))}
                        />
                    );
                })}
            </div>

            {/* Controles de zoom */}
            <div className="imcrm-absolute imcrm-bottom-3 imcrm-right-3 imcrm-z-20 imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-1 imcrm-shadow-imcrm-sm" onPointerDown={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" aria-label={__('Alejar')} onClick={() => zoomBy(1 / 1.2)}>
                    <Minus className="imcrm-h-3.5 imcrm-w-3.5" />
                </Button>
                <span className="imcrm-min-w-[42px] imcrm-text-center imcrm-text-[11px] imcrm-font-medium imcrm-text-muted-foreground">
                    {Math.round(view.z * 100)}%
                </span>
                <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" aria-label={__('Acercar')} onClick={() => zoomBy(1.2)}>
                    <ZoomIn className="imcrm-h-3.5 imcrm-w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" aria-label={__('Ajustar a la vista')} onClick={fit}>
                    <Maximize className="imcrm-h-3.5 imcrm-w-3.5" />
                </Button>
            </div>

            {/* Hint de navegación */}
            <div className="imcrm-pointer-events-none imcrm-absolute imcrm-bottom-3 imcrm-left-3 imcrm-z-20 imcrm-rounded-md imcrm-bg-card/80 imcrm-px-2 imcrm-py-1 imcrm-text-[10px] imcrm-text-muted-foreground imcrm-backdrop-blur">
                {__('Arrastra para moverte · Ctrl+rueda para zoom · click en un nodo para configurarlo')}
            </div>

        </div>

        {/* Panel de configuración del nodo seleccionado — HERMANO del
            contenedor, no hijo: si viviera dentro, sus eventos burbujearían
            (árbol React) hasta los handlers de paneo del lienzo. */}
        <Sheet
                open={selected !== null}
                onOpenChange={(open) => {
                    if (!open) setSelected(null);
                }}
            >
                <SheetContent className="imcrm-w-full sm:imcrm-w-[460px]">
                    {selected?.kind === 'trigger' && (
                        <>
                            <SheetHeader>
                                <div>
                                    <SheetTitle>{__('Trigger — Cuando')}</SheetTitle>
                                    <SheetDescription>
                                        {__('Define qué evento dispara la automatización.')}
                                    </SheetDescription>
                                </div>
                                <SheetCloseButton aria-label={__('Cerrar')} />
                            </SheetHeader>
                            <SheetBody className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                                <Select
                                    value={triggerType}
                                    onChange={(e) => onTriggerTypeChange(e.target.value)}
                                    aria-label={__('Trigger')}
                                >
                                    {triggers.map((t) => (
                                        <option key={t.slug} value={t.slug}>
                                            {t.label}
                                        </option>
                                    ))}
                                </Select>
                                {helpForTrigger(triggerType) !== '' && (
                                    <p className="imcrm-rounded-lg imcrm-border imcrm-border-info/20 imcrm-bg-info/5 imcrm-p-3 imcrm-text-[12px] imcrm-leading-relaxed">
                                        {helpForTrigger(triggerType)}
                                    </p>
                                )}
                                <TriggerConfigEditor
                                    triggerType={triggerType}
                                    config={triggerConfig}
                                    onChange={onTriggerConfigChange}
                                    fields={fields}
                                />
                            </SheetBody>
                        </>
                    )}

                    {selected?.kind === 'action' && selectedSpec !== undefined && (
                        <NodeConfigPanel
                            key={pathKey(selected.path)}
                            spec={selectedSpec}
                            onChange={(next) =>
                                onActionsChange(updateNode(actions, selected.path, next))
                            }
                            actionsCatalog={actionsCatalog}
                            fields={fields}
                        />
                    )}
                </SheetContent>
            </Sheet>
        </>
    );
}

/* ── Nodo del lienzo ──────────────────────────────────────────────── */

function CanvasNode({
    node,
    tone,
    overline,
    icon,
    title,
    badge,
    selected,
    onSelect,
    onDuplicate,
    onDelete,
}: {
    node: LNode;
    tone: 'primary' | 'neutral' | 'branch';
    overline: string;
    icon: React.ReactNode;
    title: string;
    badge?: string;
    selected: boolean;
    onSelect: () => void;
    onDuplicate?: () => void;
    onDelete?: () => void;
}): JSX.Element {
    return (
        <div
            className={cn(
                'imcrm-group imcrm-absolute imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-bg-card imcrm-px-3 imcrm-py-2.5 imcrm-shadow-imcrm-sm imcrm-transition-shadow hover:imcrm-shadow-imcrm-md',
                tone === 'primary' && 'imcrm-border-primary/30',
                tone === 'branch' && 'imcrm-border-info/40',
                tone === 'neutral' && 'imcrm-border-border',
                selected && 'imcrm-ring-2 imcrm-ring-primary imcrm-border-transparent',
            )}
            style={{ left: node.x, top: node.y, width: node.w, height: node.h }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onSelect}
            role="button"
            tabIndex={0}
            data-node-id={node.id}
            onKeyDown={(e) => {
                if (e.key === 'Enter') onSelect();
            }}
        >
            <span
                className={cn(
                    'imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-xl imcrm-ring-1',
                    tone === 'primary' && 'imcrm-bg-primary/10 imcrm-text-primary imcrm-ring-primary/20',
                    tone === 'branch' && 'imcrm-bg-info/10 imcrm-text-info imcrm-ring-info/25',
                    tone === 'neutral' && 'imcrm-bg-muted imcrm-text-foreground/70 imcrm-ring-border',
                )}
                aria-hidden
            >
                {icon}
            </span>
            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                    <span className="imcrm-truncate imcrm-text-[10px] imcrm-font-bold imcrm-uppercase imcrm-tracking-[0.08em] imcrm-text-muted-foreground">
                        {overline}
                    </span>
                    {badge !== undefined && (
                        <span className="imcrm-shrink-0 imcrm-rounded-full imcrm-border imcrm-border-border imcrm-px-1.5 imcrm-text-[9px] imcrm-font-semibold imcrm-text-muted-foreground">
                            {badge}
                        </span>
                    )}
                </span>
                <span className="imcrm-line-clamp-2 imcrm-text-[12.5px] imcrm-font-medium imcrm-leading-snug">
                    {title}
                </span>
            </span>

            {(onDuplicate || onDelete) && (
                <span className="imcrm-absolute imcrm--top-3 imcrm-right-2 imcrm-hidden imcrm-items-center imcrm-gap-0.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-0.5 imcrm-shadow-imcrm-sm group-hover:imcrm-flex">
                    {onDuplicate && (
                        <button
                            type="button"
                            className="imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground"
                            aria-label={__('Duplicar')}
                            title={__('Duplicar')}
                            onClick={(e) => {
                                e.stopPropagation();
                                onDuplicate();
                            }}
                        >
                            <Copy className="imcrm-h-3 imcrm-w-3" />
                        </button>
                    )}
                    {onDelete && (
                        <button
                            type="button"
                            className="imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                            aria-label={__('Eliminar')}
                            title={__('Eliminar')}
                            onClick={(e) => {
                                e.stopPropagation();
                                onDelete();
                            }}
                        >
                            <Trash2 className="imcrm-h-3 imcrm-w-3" />
                        </button>
                    )}
                </span>
            )}
        </div>
    );
}

/* ── Panel de configuración por nodo ──────────────────────────────── */

function NodeConfigPanel({
    spec,
    onChange,
    actionsCatalog,
    fields,
}: {
    spec: ActionSpec;
    onChange: (next: ActionSpec) => void;
    actionsCatalog: ActionMeta[];
    fields: FieldEntity[];
}): JSX.Element {
    const meta = actionMetaFor(spec.type);
    const label = actionsCatalog.find((a) => a.slug === spec.type)?.label ?? meta.title;
    const isIf = spec.type === 'if_else';

    return (
        <>
            <SheetHeader>
                <div>
                    <SheetTitle>{label}</SheetTitle>
                    <SheetDescription>
                        {isIf
                            ? __('Define la condición. Las ramas Sí / No se editan directamente en el lienzo.')
                            : __(meta.description)}
                    </SheetDescription>
                </div>
                <SheetCloseButton aria-label={__('Cerrar')} />
            </SheetHeader>
            <SheetBody className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                {isIf ? (
                    <ConditionEditor
                        value={
                            spec.config.condition as ConditionRule[] | Record<string, unknown> | undefined
                        }
                        onChange={(next) =>
                            onChange({ ...spec, config: { ...spec.config, condition: next } })
                        }
                        fields={fields}
                        helperText={__(
                            'Si el registro cumple TODAS las condiciones se ejecuta la rama Sí; si no, la rama No.',
                        )}
                    />
                ) : (
                    <>
                        <Select
                            value={spec.type}
                            onChange={(e) => onChange({ type: e.target.value, config: {} })}
                            aria-label={__('Tipo de acción')}
                        >
                            {actionsCatalog
                                .filter((a) => a.slug !== 'if_else')
                                .map((a) => (
                                    <option key={a.slug} value={a.slug}>
                                        {a.label}
                                    </option>
                                ))}
                        </Select>
                        <ActionConfigEditor
                            spec={spec}
                            onChange={onChange}
                            fields={fields}
                            actionsCatalog={actionsCatalog}
                        />
                    </>
                )}
            </SheetBody>
        </>
    );
}
