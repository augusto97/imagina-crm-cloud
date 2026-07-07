import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Background,
    BackgroundVariant,
    Controls,
    Handle,
    Position,
    ReactFlow,
    ReactFlowProvider,
    useNodesState,
    type Edge,
    type Node,
    type NodeProps,
} from '@xyflow/react';
import {
    GitBranch,
    Mail,
    Plus,
    Trash2,
    Webhook,
    Workflow,
    X,
    Zap,
} from 'lucide-react';

import '@xyflow/react/dist/style.css';

import {
    getActionAt,
    insertActionAt,
    pathKey,
    removeActionAt,
    setActionAt,
    type ActionPath,
} from '@/admin/automations/actionPath';
import {
    ActionConfigEditor,
    TriggerConfigEditor,
} from '@/admin/automations/AutomationDialog';
import {
    layoutChain,
    NODE_GAP_Y,
    NODE_WIDTH,
    type ActionNodeData,
    type SlotNodeData,
} from '@/admin/automations/visualBuilderLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useFields } from '@/hooks/useFields';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type {
    ActionMeta,
    ActionSpec,
    TriggerConfig,
    TriggerMeta,
} from '@/types/automation';

/**
 * Visual Builder funcional para automatizaciones (rework 0.2.0).
 *
 * Layout dos columnas:
 *  - Izquierda: ReactFlow con el trigger arriba + acciones encadenadas
 *    abajo. Click en cualquier nodo lo selecciona; arrastrar reordena.
 *  - Derecha: panel de configuración del nodo seleccionado. Trigger →
 *    `<TriggerConfigEditor />`. Acción → selector de tipo + título +
 *    `<ActionConfigEditor />` específico.
 *
 * Botón "+" abre type picker para elegir qué acción agregar (en lugar
 * de defaultar al primer tipo del catálogo). Botón "Eliminar" desde el
 * panel lateral (cuando un nodo está seleccionado).
 *
 * Es feature-parity con la pestaña Formulario, pero con UX más visual.
 */
interface AutomationVisualBuilderProps {
    listId: number;
    triggerType: string;
    triggerConfig: TriggerConfig;
    onTriggerTypeChange: (next: string) => void;
    onTriggerConfigChange: (next: TriggerConfig) => void;
    triggers: TriggerMeta[];
    actions: ActionSpec[];
    actionsCatalog: ActionMeta[];
    onActionsChange: (next: ActionSpec[]) => void;
}

interface TriggerNodeData extends Record<string, unknown> {
    label: string;
    event: string;
    selected: boolean;
}

type SelectedNode =
    | { kind: 'trigger' }
    | { kind: 'action'; path: ActionPath }
    | null;

export function AutomationVisualBuilder(props: AutomationVisualBuilderProps): JSX.Element {
    return (
        <ReactFlowProvider>
            <Inner {...props} />
        </ReactFlowProvider>
    );
}

function Inner({
    listId,
    triggerType,
    triggerConfig,
    onTriggerTypeChange,
    onTriggerConfigChange,
    triggers,
    actions,
    actionsCatalog,
    onActionsChange,
}: AutomationVisualBuilderProps): JSX.Element {
    const fields = useFields(listId);
    const [selected, setSelected] = useState<SelectedNode>(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    /**
     * Path donde se insertará la nueva acción al elegir un tipo en el
     * picker. Cuando es null, se appendea al final del root (legacy
     * "Añadir acción" del FAB). Cuando viene de un slot click, lleva
     * el path EXACTO del slot.
     */
    const [insertPath, setInsertPath] = useState<ActionPath | null>(null);

    const triggerMeta = triggers.find((t) => t.slug === triggerType);

    const selectedKey = useMemo(
        () => (selected?.kind === 'action' ? pathKey(selected.path) : null),
        [selected],
    );

    // 0.36.7: layoutChain ahora se computa SIN selectedKey para que
    // los nodos estructurales se memoizen estables entre selecciones.
    // El highlight de selección se aplica abajo en un map liviano —
    // antes cada click recomputaba todo el árbol + nodos + posiciones
    // y disparaba `setNodes(initialNodes)` reseteando zoom/pan de XYFlow.
    const treeData = useMemo(
        () =>
            layoutChain(actions, 0, NODE_GAP_Y, [], {
                catalog: actionsCatalog,
                selectedKey: null,
            }),
        [actions, actionsCatalog, selectedKey],
    );

    const triggerSelected = selected?.kind === 'trigger';
    const structuralNodes = useMemo<Node[]>(() => {
        const triggerNode: Node = {
            id: 'trigger',
            type: 'trigger',
            position: { x: -NODE_WIDTH / 2, y: 0 },
            draggable: false,
            data: {
                label: triggerMeta?.label ?? __('Trigger sin definir'),
                event: triggerMeta?.event ?? '',
                selected: false,
            } satisfies TriggerNodeData,
        };
        return [triggerNode, ...treeData.nodes];
    }, [treeData.nodes, triggerMeta]);

    // Aplica el highlight de selección en un map liviano. Sólo cambia
    // el `data.selected` flag del nodo afectado — XYFlow conserva
    // posiciones/zoom porque las referencias de los demás nodos no
    // cambian (objeto idéntico pasa por reference equality).
    const initialNodes = useMemo<Node[]>(() => {
        if (selected === null) return structuralNodes;
        return structuralNodes.map((n) => {
            if (n.id === 'trigger' && triggerSelected) {
                return { ...n, data: { ...(n.data as TriggerNodeData), selected: true } };
            }
            if (n.type === 'action' && selectedKey !== null) {
                const data = n.data as ActionNodeData;
                if (pathKey(data.path) === selectedKey) {
                    return { ...n, data: { ...data, selected: true } };
                }
            }
            return n;
        });
    }, [structuralNodes, triggerSelected, selectedKey, selected]);

    const edges = useMemo<Edge[]>(() => {
        const all = [...treeData.edges];
        if (treeData.firstNodeId !== null) {
            all.unshift({
                id: 'e-trigger-first',
                source: 'trigger',
                target: treeData.firstNodeId,
                animated: true,
            });
        }
        return all;
    }, [treeData.edges, treeData.firstNodeId]);

    const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

    useEffect(() => {
        setNodes(initialNodes);
    }, [initialNodes, setNodes]);

    const handleNodeClick = useCallback(
        (_event: React.MouseEvent, node: Node) => {
            if (node.type === 'trigger') {
                setSelected({ kind: 'trigger' });
            } else if (node.type === 'action') {
                const path = (node.data as ActionNodeData).path;
                setSelected({ kind: 'action', path });
            } else if (node.type === 'slot') {
                // Click en un slot: abre el picker apuntando a ese slot.
                const slotPath = (node.data as SlotNodeData).insertPath;
                setInsertPath(slotPath);
                setPickerOpen(true);
            }
        },
        [],
    );

    const handleAdd = (typeSlug: string): void => {
        const newAction: ActionSpec = { type: typeSlug, config: {} };
        if (insertPath !== null) {
            // Insert quirúrgico en el slot elegido. El path del nuevo
            // nodo es justo `insertPath` (que es la posición del slot
            // = índice de inserción en su chain).
            onActionsChange(insertActionAt(actions, insertPath, newAction));
            setSelected({ kind: 'action', path: insertPath });
        } else {
            // Fallback (FAB "Añadir acción"): append al final del root.
            onActionsChange([...actions, newAction]);
            setSelected({ kind: 'action', path: [actions.length] });
        }
        setInsertPath(null);
        setPickerOpen(false);
    };

    const handleDeleteSelected = (): void => {
        if (selected?.kind === 'action') {
            onActionsChange(removeActionAt(actions, selected.path));
            setSelected(null);
        }
    };

    const selectedAction =
        selected?.kind === 'action' ? getActionAt(actions, selected.path) : undefined;

    return (
        <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-4 lg:imcrm-grid-cols-[3fr_1fr] imcrm-h-[min(78vh,820px)]">
            {/* Flow canvas — fills available height; el modal en visual
                 mode tiene max-h:95vh, así que el canvas usa todo el alto
                 menos los ~150px del header del dialog + tabs. */}
            <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-col imcrm-gap-2">
                <div className="imcrm-relative imcrm-min-h-0 imcrm-flex-1 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-gradient-to-br imcrm-from-muted/30 imcrm-to-muted/10 imcrm-shadow-imcrm-sm">
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onNodeClick={handleNodeClick}
                        onPaneClick={() => setSelected(null)}
                        nodeTypes={NODE_TYPES}
                        nodesConnectable={false}
                        edgesFocusable={false}
                        nodesDraggable={false}
                        fitView
                        fitViewOptions={{ padding: 0.25 }}
                        minZoom={0.4}
                        proOptions={{ hideAttribution: true }}
                    >
                        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
                        <Controls showInteractive={false} />
                    </ReactFlow>

                    {/* Floating + button con type picker */}
                    <div className="imcrm-absolute imcrm-bottom-3 imcrm-right-3 imcrm-z-10">
                        {pickerOpen && (
                            <div className="imcrm-absolute imcrm-bottom-12 imcrm-right-0 imcrm-min-w-[260px] imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-lg">
                                <header className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-border-b imcrm-border-border imcrm-px-3.5 imcrm-py-2.5">
                                    <span className="imcrm-text-[11px] imcrm-font-bold imcrm-uppercase imcrm-tracking-[0.06em] imcrm-text-muted-foreground">
                                        {insertPath !== null
                                            ? __('Insertar acción aquí')
                                            : __('Tipo de acción')}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setPickerOpen(false);
                                            setInsertPath(null);
                                        }}
                                        className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-foreground/[0.04] hover:imcrm-text-foreground"
                                        aria-label={__('Cerrar')}
                                    >
                                        <X className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </button>
                                </header>
                                <ul className="imcrm-flex imcrm-flex-col imcrm-p-1.5">
                                    {actionsCatalog.map((a) => (
                                        <li key={a.slug}>
                                            <button
                                                type="button"
                                                onClick={() => handleAdd(a.slug)}
                                                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2.5 imcrm-py-2 imcrm-text-[13px] imcrm-text-left hover:imcrm-bg-accent"
                                            >
                                                <span className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-bg-muted imcrm-text-muted-foreground">
                                                    {iconForActionType(a.slug)}
                                                </span>
                                                {a.label}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        <Button
                            type="button"
                            onClick={() => {
                                setInsertPath(null);
                                setPickerOpen((p) => !p);
                            }}
                            disabled={actionsCatalog.length === 0}
                            className="imcrm-gap-2 imcrm-shadow-imcrm-md"
                        >
                            <Plus className="imcrm-h-4 imcrm-w-4" />
                            {__('Añadir al final')}
                        </Button>
                    </div>
                </div>

                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Click en un nodo para configurarlo. Click en un slot "+" entre nodos para insertar una acción ahí. Las ramas Sí/No del condicional tienen sus propios slots.')}
                </p>
            </div>

            {/* Side panel: editor del nodo seleccionado */}
            <aside className="imcrm-flex imcrm-min-h-0 imcrm-flex-col imcrm-gap-3 imcrm-overflow-y-auto imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3 imcrm-shadow-imcrm-sm">
                {selected === null ? (
                    <EmptyPanel />
                ) : selected.kind === 'trigger' ? (
                    <TriggerEditorPanel
                        triggerType={triggerType}
                        triggerConfig={triggerConfig}
                        triggers={triggers}
                        fields={fields.data ?? []}
                        onTypeChange={onTriggerTypeChange}
                        onConfigChange={onTriggerConfigChange}
                    />
                ) : selectedAction ? (
                    <ActionEditorPanel
                        spec={selectedAction}
                        actionsCatalog={actionsCatalog}
                        fields={fields.data ?? []}
                        onChange={(next) => {
                            if (selected?.kind !== 'action') return;
                            onActionsChange(setActionAt(actions, selected.path, next));
                        }}
                        onDelete={handleDeleteSelected}
                    />
                ) : (
                    <EmptyPanel />
                )}
            </aside>
        </div>
    );
}

function EmptyPanel(): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-p-2">
            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-canvas imcrm-px-4 imcrm-py-6 imcrm-text-center">
                <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary">
                    <Workflow className="imcrm-h-5 imcrm-w-5" />
                </span>
                <p className="imcrm-text-sm imcrm-font-semibold">{__('Selecciona un nodo')}</p>
                <p className="imcrm-text-xs imcrm-text-muted-foreground imcrm-leading-relaxed">
                    {__('Click en el trigger o en una acción del diagrama para editar su configuración aquí.')}
                </p>
            </div>

            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-text-[12px] imcrm-text-muted-foreground">
                <li className="imcrm-flex imcrm-items-start imcrm-gap-2">
                    <span className="imcrm-mt-1.5 imcrm-h-1 imcrm-w-1 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-primary" />
                    <span>{__('Usa el botón "Añadir acción" para sumar pasos al flujo.')}</span>
                </li>
                <li className="imcrm-flex imcrm-items-start imcrm-gap-2">
                    <span className="imcrm-mt-1.5 imcrm-h-1 imcrm-w-1 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-primary" />
                    <span>{__('Las acciones "Si / sino" abren dos ramas con sus propias acciones nested.')}</span>
                </li>
                <li className="imcrm-flex imcrm-items-start imcrm-gap-2">
                    <span className="imcrm-mt-1.5 imcrm-h-1 imcrm-w-1 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-primary" />
                    <span>{__('Para reordenar acciones, cambia a la vista Formulario.')}</span>
                </li>
            </ul>
        </div>
    );
}

interface TriggerEditorPanelProps {
    triggerType: string;
    triggerConfig: TriggerConfig;
    triggers: TriggerMeta[];
    fields: Parameters<typeof TriggerConfigEditor>[0]['fields'];
    onTypeChange: (next: string) => void;
    onConfigChange: (next: TriggerConfig) => void;
}

function TriggerEditorPanel({
    triggerType,
    triggerConfig,
    triggers,
    fields,
    onTypeChange,
    onConfigChange,
}: TriggerEditorPanelProps): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <header className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary imcrm-text-primary-foreground">
                    <Zap className="imcrm-h-4 imcrm-w-4" />
                </span>
                <div>
                    <span className="imcrm-text-[11px] imcrm-uppercase imcrm-tracking-wide imcrm-text-primary">
                        {__('Trigger')}
                    </span>
                    <h3 className="imcrm-text-sm imcrm-font-medium">{__('Cuándo dispara')}</h3>
                </div>
            </header>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="visual-trigger-type">{__('Tipo')}</Label>
                <Select
                    id="visual-trigger-type"
                    value={triggerType}
                    onChange={(e) => {
                        onTypeChange(e.target.value);
                        // Reset config al cambiar tipo (las shapes son distintas).
                        onConfigChange({});
                    }}
                >
                    {triggers.map((t) => (
                        <option key={t.slug} value={t.slug}>
                            {t.label}
                        </option>
                    ))}
                </Select>
            </div>

            <TriggerConfigEditor
                triggerType={triggerType}
                config={triggerConfig}
                onChange={onConfigChange}
                fields={fields}
            />
        </div>
    );
}

interface ActionEditorPanelProps {
    spec: ActionSpec;
    actionsCatalog: ActionMeta[];
    fields: Parameters<typeof ActionConfigEditor>[0]['fields'];
    onChange: (next: ActionSpec) => void;
    onDelete: () => void;
}

function ActionEditorPanel({
    spec,
    actionsCatalog,
    fields,
    onChange,
    onDelete,
}: ActionEditorPanelProps): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <header className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-muted-foreground">
                        {iconForActionType(spec.type)}
                    </span>
                    <div>
                        <span className="imcrm-text-[11px] imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                            {__('Acción')}
                        </span>
                        <h3 className="imcrm-text-sm imcrm-font-medium">
                            {actionsCatalog.find((a) => a.slug === spec.type)?.label ?? spec.type}
                        </h3>
                    </div>
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={onDelete}
                    aria-label={__('Eliminar acción')}
                    className="imcrm-text-destructive hover:imcrm-text-destructive"
                >
                    <Trash2 className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </header>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="visual-action-title">{__('Título (opcional)')}</Label>
                <Input
                    id="visual-action-title"
                    value={typeof spec.config.title === 'string' ? spec.config.title : ''}
                    onChange={(e) =>
                        onChange({
                            ...spec,
                            config: { ...spec.config, title: e.target.value },
                        })
                    }
                    placeholder={__('Ej. Marcar como vencido')}
                />
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="visual-action-type">{__('Tipo')}</Label>
                <Select
                    id="visual-action-type"
                    value={spec.type}
                    onChange={(e) => {
                        // Reset config al cambiar tipo.
                        onChange({ ...spec, type: e.target.value, config: {} });
                    }}
                >
                    {actionsCatalog.map((a) => (
                        <option key={a.slug} value={a.slug}>
                            {a.label}
                        </option>
                    ))}
                </Select>
            </div>

            <ActionConfigEditor
                spec={spec}
                onChange={onChange}
                fields={fields}
                actionsCatalog={actionsCatalog}
            />
        </div>
    );
}

const NODE_TYPES = {
    trigger: TriggerNode,
    action: ActionNode,
    slot: SlotNode,
};

/**
 * Slot de inserción entre dos nodos (o al final de una chain). Click
 * abre el picker con `insertPath = node.data.insertPath`. Visualmente:
 * un círculo dashed pequeño con "+", que en hover se rellena en
 * primary — afordance clara de "puedes agregar algo aquí".
 */
function SlotNode({ data }: NodeProps): JSX.Element {
    void data; // path se lee desde el node.data en handleNodeClick.
    return (
        <div
            className={cn(
                'imcrm-flex imcrm-h-6 imcrm-w-8 imcrm-cursor-pointer imcrm-items-center imcrm-justify-center imcrm-rounded-full',
                'imcrm-border imcrm-border-dashed imcrm-border-muted-foreground/40 imcrm-bg-card/80 imcrm-text-muted-foreground',
                'hover:imcrm-border-primary hover:imcrm-bg-primary hover:imcrm-text-primary-foreground',
                'imcrm-transition-colors imcrm-duration-150',
            )}
            title={__('Insertar acción aquí')}
        >
            <Handle
                type="target"
                position={Position.Top}
                className="!imcrm-h-1 !imcrm-w-1 !imcrm-bg-transparent !imcrm-border-0"
                isConnectable={false}
            />
            <Plus className="imcrm-h-3 imcrm-w-3" />
            <Handle
                type="source"
                position={Position.Bottom}
                className="!imcrm-h-1 !imcrm-w-1 !imcrm-bg-transparent !imcrm-border-0"
                isConnectable={false}
            />
        </div>
    );
}


function TriggerNode({ data }: NodeProps): JSX.Element {
    const d = data as TriggerNodeData;
    return (
        <div
            className={cn(
                'imcrm-rounded-lg imcrm-border-2 imcrm-bg-primary/5 imcrm-px-4 imcrm-py-3 imcrm-shadow-imcrm-md imcrm-cursor-pointer',
                d.selected
                    ? 'imcrm-border-primary imcrm-ring-2 imcrm-ring-primary/30'
                    : 'imcrm-border-primary/40 hover:imcrm-border-primary',
            )}
            style={{ width: NODE_WIDTH }}
        >
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary imcrm-text-primary-foreground">
                    <Zap className="imcrm-h-4 imcrm-w-4" />
                </span>
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                    <span className="imcrm-text-[11px] imcrm-uppercase imcrm-tracking-wide imcrm-text-primary">
                        {__('Trigger')}
                    </span>
                    <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{d.label}</span>
                </div>
            </div>
            {d.event !== '' && (
                <code className="imcrm-mt-2 imcrm-block imcrm-text-[10px] imcrm-text-muted-foreground">
                    {d.event}
                </code>
            )}
            <Handle
                type="source"
                position={Position.Bottom}
                isConnectable={false}
                className="!imcrm-h-1 !imcrm-w-1 !imcrm-bg-transparent !imcrm-border-0"
            />
        </div>
    );
}

function ActionNode({ data }: NodeProps): JSX.Element {
    const d = data as ActionNodeData;
    const isIf = d.branchKind === 'if_else';
    // Posición del último elemento del path: dentro de which branch vive
    // este nodo (root si no hay branch).
    const ownBranch = (() => {
        for (let i = d.path.length - 1; i >= 0; i--) {
            const seg = d.path[i];
            if (seg === 'then' || seg === 'else') return seg;
        }
        return null;
    })();
    const stepNumber =
        typeof d.path[d.path.length - 1] === 'number'
            ? Number(d.path[d.path.length - 1]) + 1
            : 1;

    return (
        <div
            className={cn(
                'imcrm-rounded-xl imcrm-border-2 imcrm-px-3.5 imcrm-py-2.5 imcrm-cursor-pointer imcrm-transition-all imcrm-duration-150',
                isIf
                    ? 'imcrm-bg-gradient-to-br imcrm-from-primary/10 imcrm-to-primary/5 imcrm-shadow-imcrm-md'
                    : 'imcrm-bg-card imcrm-shadow-imcrm-sm hover:imcrm-shadow-imcrm-md',
                d.selected
                    ? 'imcrm-border-primary imcrm-ring-2 imcrm-ring-primary/30'
                    : isIf
                      ? 'imcrm-border-primary/50 hover:imcrm-border-primary'
                      : 'imcrm-border-border hover:imcrm-border-muted-foreground',
            )}
            style={{ width: NODE_WIDTH }}
        >
            <Handle
                type="target"
                position={Position.Top}
                isConnectable={false}
                className="!imcrm-h-1 !imcrm-w-1 !imcrm-bg-transparent !imcrm-border-0"
            />

            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <span
                    className={cn(
                        'imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full',
                        isIf
                            ? 'imcrm-bg-primary imcrm-text-primary-foreground'
                            : 'imcrm-bg-muted imcrm-text-muted-foreground',
                    )}
                >
                    {iconForActionType(d.type)}
                </span>
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                    <span
                        className={cn(
                            'imcrm-text-[10px] imcrm-uppercase imcrm-font-semibold imcrm-tracking-wide',
                            isIf ? 'imcrm-text-primary' : 'imcrm-text-muted-foreground',
                        )}
                    >
                        {ownBranch === 'then'
                            ? `${__('Sí')} · ${stepNumber}`
                            : ownBranch === 'else'
                              ? `${__('No')} · ${stepNumber}`
                              : `${__('Acción')} ${stepNumber}`}
                    </span>
                    <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium">
                        {d.title || d.label}
                    </span>
                </div>
            </div>

            {isIf ? (
                <>
                    {/* Dos handles de salida: then a la izq, else a la der.
                         Los IDs los usa `layoutChain` para conectar al
                         primer nodo de cada branch. */}
                    <Handle
                        type="source"
                        position={Position.Bottom}
                        id="then"
                        isConnectable={false}
                        style={{
                            left: '25%',
                            background: 'transparent',
                            width: 4,
                            height: 4,
                            border: 0,
                        }}
                    />
                    <Handle
                        type="source"
                        position={Position.Bottom}
                        id="else"
                        isConnectable={false}
                        style={{
                            left: '75%',
                            background: 'transparent',
                            width: 4,
                            height: 4,
                            border: 0,
                        }}
                    />
                </>
            ) : (
                <Handle
                    type="source"
                    position={Position.Bottom}
                    isConnectable={false}
                    className="!imcrm-h-1 !imcrm-w-1 !imcrm-bg-transparent !imcrm-border-0"
                />
            )}
        </div>
    );
}

function iconForActionType(type: string): JSX.Element {
    switch (type) {
        case 'send_email':
            return <Mail className="imcrm-h-3.5 imcrm-w-3.5" />;
        case 'call_webhook':
            return <Webhook className="imcrm-h-3.5 imcrm-w-3.5" />;
        case 'if_else':
            return <GitBranch className="imcrm-h-3.5 imcrm-w-3.5" />;
        case 'update_field':
        default:
            return <Workflow className="imcrm-h-3.5 imcrm-w-3.5" />;
    }
}
