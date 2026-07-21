import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    AlertCircle,
    ArrowDown,
    ArrowLeft,
    ArrowUp,
    ChevronDown,
    Copy,
    History,
    LayoutList,
    Loader2,
    Plus,
    Trash2,
    Workflow,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import {
    useActionCatalog,
    useAutomations,
    useCreateAutomation,
    useTriggerCatalog,
    useUpdateAutomation,
} from '@/hooks/useAutomations';
import { useFields } from '@/hooks/useFields';
import { useList, useLists } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type {
    ActionMeta,
    ActionSpec,
    AutomationEntity,
    CreateAutomationInput,
    TriggerMeta,
} from '@/types/automation';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';

import { ActionTypeMenu } from './ActionTypeMenu';
import { AutomationRunsDrawer } from './AutomationRunsDrawer';
import {
    actionConditionCount,
    actionMetaFor,
    summarizeAction,
    summarizeTrigger,
    triggerConditionCount,
    triggerMetaFor,
} from './automationMeta';
import {
    ActionConfigEditor,
    AutomationEditorListContext,
    cleanTriggerConfig,
    EMPTY_AUTOMATION_STATE,
    fromAutomation,
    helpForTrigger,
    TriggerConfigEditor,
    type AutomationFormState,
} from './config-editors';

// El lienzo visual (vista n8n/Make) se carga bajo demanda — la mayoría
// de automatizaciones simples se editan en el flujo vertical.
const AutomationCanvas = lazy(() =>
    import('./AutomationCanvas').then((m) => ({ default: m.AutomationCanvas })),
);

type EditorMode = 'flow' | 'canvas';

const MODE_STORAGE_KEY = 'imcrm-automation-editor-mode';

function initialMode(): EditorMode {
    try {
        return window.localStorage.getItem(MODE_STORAGE_KEY) === 'canvas' ? 'canvas' : 'flow';
    } catch {
        return 'flow';
    }
}

/**
 * Editor de automatizaciones a PÁGINA COMPLETA (v0.1.90) — reemplaza al
 * modal `AutomationDialog` y al canvas React Flow.
 *
 * Rutas:
 *  - `/lists/:listSlug/automations/new`         → crear
 *  - `/lists/:listSlug/automations/:automationId` → editar
 *
 * La automatización se presenta como un FLUJO VERTICAL (estilo
 * Zapier/Make): una tarjeta de trigger ("Cuando…"), conectores con
 * botón de inserción, y una tarjeta por acción — cada una editable EN
 * EL LUGAR (colapsada muestra el resumen en lenguaje humano; expandida,
 * su configuración). Un solo scroll: el de la página.
 */
export function AutomationEditorPage(): JSX.Element {
    const { listSlug, automationId } = useParams<{
        listSlug: string;
        automationId: string;
    }>();
    const isNew = automationId === undefined;
    const editId = isNew ? undefined : Number(automationId);

    const list = useList(listSlug);
    const listId = list.data?.id;
    const automations = useAutomations(listId);
    const triggers = useTriggerCatalog();
    const actionsCatalog = useActionCatalog();
    const fields = useFields(listId);
    const lists = useLists();

    const editing: AutomationEntity | undefined = useMemo(
        () => (editId !== undefined ? automations.data?.find((a) => a.id === editId) : undefined),
        [automations.data, editId],
    );

    if (list.isLoading || (editId !== undefined && automations.isLoading) || triggers.isLoading || actionsCatalog.isLoading) {
        return <EditorSkeleton />;
    }

    if (!list.data) {
        return <NotFoundNote text={__('Lista no encontrada.')} backTo="/lists" />;
    }

    if (editId !== undefined && automations.data !== undefined && editing === undefined) {
        return (
            <NotFoundNote
                text={__('Automatización no encontrada.')}
                backTo={`/lists/${list.data.slug}/automations`}
            />
        );
    }

    if (editId !== undefined && editing === undefined) {
        return <EditorSkeleton />;
    }

    return (
        <EditorBody
            key={editing?.id ?? 'new'}
            list={list.data}
            editing={editing ?? null}
            triggers={triggers.data ?? []}
            actionsCatalog={actionsCatalog.data ?? []}
            fields={fields.data ?? []}
            lists={lists.data ?? []}
        />
    );
}

function EditorBody({
    list,
    editing,
    triggers,
    actionsCatalog,
    fields,
    lists,
}: {
    list: ListSummary;
    editing: AutomationEntity | null;
    triggers: TriggerMeta[];
    actionsCatalog: ActionMeta[];
    fields: FieldEntity[];
    lists: ListSummary[];
}): JSX.Element {
    const navigate = useNavigate();
    const toast = useToast();
    const create = useCreateAutomation(list.id);
    const update = useUpdateAutomation(list.id);

    const [state, setState] = useState<AutomationFormState>(() =>
        editing ? fromAutomation(editing) : EMPTY_AUTOMATION_STATE,
    );
    const [error, setError] = useState<string | null>(null);
    const [runsOpen, setRunsOpen] = useState(false);
    const [mode, setMode] = useState<EditorMode>(initialMode);
    const switchMode = (next: EditorMode): void => {
        setMode(next);
        try {
            window.localStorage.setItem(MODE_STORAGE_KEY, next);
        } catch {
            // Storage lleno/bloqueado: el modo simplemente no persiste.
        }
    };
    // Qué tarjetas están expandidas. Al editar, todas colapsadas (el
    // flujo se lee como frases); al crear, el trigger arranca abierto.
    const [expanded, setExpanded] = useState<Set<string>>(
        () => new Set(editing ? [] : ['trigger']),
    );

    const initialJson = useRef(JSON.stringify(editing ? fromAutomation(editing) : EMPTY_AUTOMATION_STATE));
    const dirty = JSON.stringify(state) !== initialJson.current;

    // Aviso nativo al cerrar la pestaña con cambios sin guardar.
    useEffect(() => {
        if (!dirty) return;
        const handler = (e: BeforeUnloadEvent): void => {
            e.preventDefault();
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [dirty]);

    const toggleCard = (id: string): void => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const setActions = (next: ActionSpec[]): void =>
        setState((s) => ({ ...s, actions: next }));

    const insertAction = (index: number, type: string): void => {
        const next = [...state.actions];
        next.splice(index, 0, { type, config: {} });
        setActions(next);
        // La acción recién añadida se abre para configurarla al toque.
        setExpanded((prev) => {
            const ids = new Set<string>();
            for (const id of prev) {
                // Re-mapear ids de acciones que se corren un lugar.
                if (id.startsWith('action-')) {
                    const i = Number(id.slice(7));
                    ids.add(i >= index ? `action-${i + 1}` : id);
                } else {
                    ids.add(id);
                }
            }
            ids.add(`action-${index}`);
            return ids;
        });
    };

    const moveAction = (from: number, to: number): void => {
        if (to < 0 || to >= state.actions.length) return;
        const next = [...state.actions];
        const [item] = next.splice(from, 1);
        next.splice(to, 0, item!);
        setActions(next);
        // Intercambiar el estado expandido de los dos índices.
        setExpanded((prev) => {
            const next2 = new Set(prev);
            const a = next2.has(`action-${from}`);
            const b = next2.has(`action-${to}`);
            next2.delete(`action-${from}`);
            next2.delete(`action-${to}`);
            if (a) next2.add(`action-${to}`);
            if (b) next2.add(`action-${from}`);
            return next2;
        });
    };

    const removeAction = (index: number): void => {
        setActions(state.actions.filter((_, i) => i !== index));
        setExpanded((prev) => {
            const ids = new Set<string>();
            for (const id of prev) {
                if (id.startsWith('action-')) {
                    const i = Number(id.slice(7));
                    if (i === index) continue;
                    ids.add(i > index ? `action-${i - 1}` : id);
                } else {
                    ids.add(id);
                }
            }
            return ids;
        });
    };

    const duplicateAction = (index: number): void => {
        const src = state.actions[index];
        if (!src) return;
        const clone: ActionSpec = JSON.parse(JSON.stringify(src)) as ActionSpec;
        const next = [...state.actions];
        next.splice(index + 1, 0, clone);
        setActions(next);
    };

    const handleSave = async (): Promise<void> => {
        setError(null);
        if (state.name.trim() === '') {
            setError(__('Ponle un nombre a la automatización.'));
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }
        if (state.actions.length === 0) {
            setError(__('Añade al menos una acción — sin acciones la automatización no hace nada.'));
            return;
        }

        const payload: CreateAutomationInput = {
            name: state.name.trim(),
            description: state.description.trim() === '' ? null : state.description.trim(),
            trigger_type: state.triggerType,
            trigger_config: cleanTriggerConfig(state.triggerConfig),
            actions: state.actions,
            is_active: state.isActive,
        };

        try {
            if (editing) {
                await update.mutateAsync({ id: editing.id, input: payload });
                initialJson.current = JSON.stringify(state);
                toast.success(__('Automatización guardada'));
            } else {
                const created = await create.mutateAsync(payload);
                toast.success(__('Automatización creada'));
                navigate(`/lists/${list.slug}/automations/${created.id}`, { replace: true });
            }
        } catch (err) {
            if (err instanceof ApiError) {
                const detail = Object.entries(err.errors)
                    .map(([path, msg]) => `${path}: ${msg}`)
                    .join(' · ');
                setError(detail !== '' ? `${err.message} — ${detail}` : err.message);
            } else if (err instanceof Error) {
                setError(err.message);
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const isPending = create.isPending || update.isPending;
    const triggerMeta = triggerMetaFor(state.triggerType);
    const triggerFilters = triggerConditionCount(state.triggerConfig);

    return (
        <AutomationEditorListContext.Provider value={list.id}>
            <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-[880px] imcrm-flex-col imcrm-gap-5 imcrm-pb-24">
                {/* ── Header ─────────────────────────────────────────── */}
                <header className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-[13px] imcrm-text-muted-foreground">
                        <Button asChild variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7" aria-label={__('Volver a automatizaciones')}>
                            <Link to={`/lists/${list.slug}/automations`}>
                                <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                            </Link>
                        </Button>
                        <Link to={`/lists/${list.slug}/records`} className="hover:imcrm-underline">
                            {list.name}
                        </Link>
                        <span aria-hidden>/</span>
                        <Link to={`/lists/${list.slug}/automations`} className="hover:imcrm-underline">
                            {__('Automatizaciones')}
                        </Link>
                    </div>

                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-0.5">
                            <input
                                value={state.name}
                                onChange={(e) => setState((s) => ({ ...s, name: e.target.value }))}
                                placeholder={__('Nombre de la automatización')}
                                aria-label={__('Nombre')}
                                className="imcrm-w-full imcrm-border-0 imcrm-bg-transparent imcrm-p-0 imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight imcrm-outline-none placeholder:imcrm-text-muted-foreground/50 focus:imcrm-ring-0"
                            />
                            <input
                                value={state.description}
                                onChange={(e) => setState((s) => ({ ...s, description: e.target.value }))}
                                placeholder={__('Añade una descripción (opcional)…')}
                                aria-label={__('Descripción')}
                                className="imcrm-w-full imcrm-border-0 imcrm-bg-transparent imcrm-p-0 imcrm-text-[13px] imcrm-text-muted-foreground imcrm-outline-none placeholder:imcrm-text-muted-foreground/40 focus:imcrm-ring-0"
                            />
                        </div>

                        <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-2">
                            <ModeSwitcher mode={mode} onChange={switchMode} />
                            <ActiveTogglePill
                                active={state.isActive}
                                onChange={(next) => setState((s) => ({ ...s, isActive: next }))}
                            />
                            {editing && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="imcrm-gap-1.5"
                                    onClick={() => setRunsOpen(true)}
                                >
                                    <History className="imcrm-h-3.5 imcrm-w-3.5" />
                                    {__('Historial')}
                                </Button>
                            )}
                            <Button size="sm" onClick={handleSave} disabled={isPending} className="imcrm-gap-1.5">
                                {isPending && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                                {isPending ? __('Guardando…') : __('Guardar')}
                            </Button>
                        </div>
                    </div>

                    {dirty && !isPending && (
                        <p className="imcrm-text-[11px] imcrm-font-medium imcrm-text-warning">
                            {__('Cambios sin guardar')}
                        </p>
                    )}
                </header>

                {error && (
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive">
                        <AlertCircle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                        <span>{error}</span>
                    </div>
                )}

                {/* ── Lienzo visual (vista n8n/Make) ─────────────────── */}
                {mode === 'canvas' && (
                    <div className="imcrm-h-[calc(100vh-240px)] imcrm-min-h-[460px]">
                        <Suspense
                            fallback={
                                <div className="imcrm-flex imcrm-h-full imcrm-items-center imcrm-justify-center imcrm-rounded-2xl imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-text-sm imcrm-text-muted-foreground">
                                    <Loader2 className="imcrm-mr-2 imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                                    {__('Cargando lienzo…')}
                                </div>
                            }
                        >
                            <AutomationCanvas
                                triggerType={state.triggerType}
                                triggerConfig={state.triggerConfig}
                                onTriggerTypeChange={(next) =>
                                    setState((s) => ({ ...s, triggerType: next, triggerConfig: {} }))
                                }
                                onTriggerConfigChange={(triggerConfig) =>
                                    setState((s) => ({ ...s, triggerConfig }))
                                }
                                actions={state.actions}
                                onActionsChange={setActions}
                                triggers={triggers}
                                actionsCatalog={actionsCatalog}
                                fields={fields}
                                lists={lists}
                            />
                        </Suspense>
                    </div>
                )}

                {/* ── Flujo vertical ─────────────────────────────────── */}
                {mode === 'flow' && (
                <div className="imcrm-flex imcrm-flex-col">
                    {/* Trigger */}
                    <FlowCard
                        tone="primary"
                        overline={__('Cuando')}
                        icon={<triggerMeta.icon className="imcrm-h-4 imcrm-w-4" />}
                        title={summarizeTrigger(state.triggerType, state.triggerConfig, fields)}
                        badges={
                            triggerFilters > 0 ? (
                                <Badge variant="outline" className="imcrm-shrink-0">
                                    {sprintf(
                                        /* translators: %d: filter count */
                                        __('%d condiciones'),
                                        triggerFilters,
                                    )}
                                </Badge>
                            ) : undefined
                        }
                        expanded={expanded.has('trigger')}
                        onToggle={() => toggleCard('trigger')}
                    >
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                            <Select
                                value={state.triggerType}
                                onChange={(e) =>
                                    setState((s) => ({
                                        ...s,
                                        triggerType: e.target.value,
                                        triggerConfig: {},
                                    }))
                                }
                                aria-label={__('Trigger')}
                            >
                                {triggers.map((t) => (
                                    <option key={t.slug} value={t.slug}>
                                        {t.label}
                                    </option>
                                ))}
                            </Select>
                            {helpForTrigger(state.triggerType) !== '' && (
                                <p className="imcrm-rounded-lg imcrm-border imcrm-border-info/20 imcrm-bg-info/5 imcrm-p-3 imcrm-text-[12px] imcrm-leading-relaxed imcrm-text-foreground">
                                    {helpForTrigger(state.triggerType)}
                                </p>
                            )}
                            <TriggerConfigEditor
                                triggerType={state.triggerType}
                                config={state.triggerConfig}
                                onChange={(triggerConfig) => setState((s) => ({ ...s, triggerConfig }))}
                                fields={fields}
                            />
                        </div>
                    </FlowCard>

                    {/* Conector + acciones */}
                    {state.actions.map((spec, i) => {
                        const meta = actionMetaFor(spec.type);
                        const condCount = actionConditionCount(spec);
                        return (
                            <div key={i} className="imcrm-flex imcrm-flex-col">
                                <FlowConnector
                                    actionsCatalog={actionsCatalog}
                                    onInsert={(type) => insertAction(i, type)}
                                />
                                <FlowCard
                                    tone="neutral"
                                    overline={sprintf(
                                        /* translators: %d: step number */
                                        __('Paso %d'),
                                        i + 1,
                                    )}
                                    icon={<meta.icon className="imcrm-h-4 imcrm-w-4" />}
                                    title={summarizeAction(spec, fields, lists)}
                                    badges={
                                        condCount > 0 ? (
                                            <Badge variant="outline" className="imcrm-shrink-0">
                                                {sprintf(
                                                    /* translators: %d: condition count */
                                                    __('%d cond.'),
                                                    condCount,
                                                )}
                                            </Badge>
                                        ) : undefined
                                    }
                                    expanded={expanded.has(`action-${i}`)}
                                    onToggle={() => toggleCard(`action-${i}`)}
                                    toolbar={
                                        <>
                                            <IconGhost
                                                label={__('Subir')}
                                                disabled={i === 0}
                                                onClick={() => moveAction(i, i - 1)}
                                            >
                                                <ArrowUp className="imcrm-h-3.5 imcrm-w-3.5" />
                                            </IconGhost>
                                            <IconGhost
                                                label={__('Bajar')}
                                                disabled={i === state.actions.length - 1}
                                                onClick={() => moveAction(i, i + 1)}
                                            >
                                                <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" />
                                            </IconGhost>
                                            <IconGhost label={__('Duplicar')} onClick={() => duplicateAction(i)}>
                                                <Copy className="imcrm-h-3.5 imcrm-w-3.5" />
                                            </IconGhost>
                                            <IconGhost label={__('Eliminar acción')} onClick={() => removeAction(i)}>
                                                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                            </IconGhost>
                                        </>
                                    }
                                >
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                                        <Select
                                            value={spec.type}
                                            onChange={(e) => {
                                                const next = [...state.actions];
                                                next[i] = { type: e.target.value, config: {} };
                                                setActions(next);
                                            }}
                                            aria-label={__('Tipo de acción')}
                                        >
                                            {actionsCatalog.map((a) => (
                                                <option key={a.slug} value={a.slug}>
                                                    {a.label}
                                                </option>
                                            ))}
                                        </Select>
                                        <ActionConfigEditor
                                            spec={spec}
                                            onChange={(next) => {
                                                const arr = [...state.actions];
                                                arr[i] = next;
                                                setActions(arr);
                                            }}
                                            fields={fields}
                                            actionsCatalog={actionsCatalog}
                                        />
                                    </div>
                                </FlowCard>
                            </div>
                        );
                    })}

                    {/* Añadir al final */}
                    <FlowConnector
                        actionsCatalog={actionsCatalog}
                        onInsert={(type) => insertAction(state.actions.length, type)}
                        terminal
                    />
                    <AddActionCard
                        actionsCatalog={actionsCatalog}
                        onInsert={(type) => insertAction(state.actions.length, type)}
                        isFirst={state.actions.length === 0}
                    />
                </div>
                )}
            </div>

            {editing && (
                <AutomationRunsDrawer
                    automation={editing}
                    open={runsOpen}
                    onOpenChange={setRunsOpen}
                />
            )}
        </AutomationEditorListContext.Provider>
    );
}

/* ── Piezas del flujo ─────────────────────────────────────────────── */

function FlowCard({
    tone,
    overline,
    icon,
    title,
    badges,
    toolbar,
    expanded,
    onToggle,
    children,
}: {
    tone: 'primary' | 'neutral';
    overline: string;
    icon: React.ReactNode;
    title: string;
    badges?: React.ReactNode;
    toolbar?: React.ReactNode;
    expanded: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <section
            className={cn(
                'imcrm-rounded-2xl imcrm-border imcrm-bg-card imcrm-shadow-imcrm-sm imcrm-transition-shadow',
                tone === 'primary' ? 'imcrm-border-primary/25' : 'imcrm-border-border',
                expanded && 'imcrm-shadow-imcrm-md',
            )}
        >
            <header
                className="imcrm-group imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-3 imcrm-px-4 imcrm-py-3"
                onClick={onToggle}
                role="button"
                tabIndex={0}
                aria-expanded={expanded}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onToggle();
                    }
                }}
            >
                <span
                    className={cn(
                        'imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-xl imcrm-ring-1',
                        tone === 'primary'
                            ? 'imcrm-bg-primary/10 imcrm-text-primary imcrm-ring-primary/20'
                            : 'imcrm-bg-muted imcrm-text-foreground/70 imcrm-ring-border',
                    )}
                    aria-hidden
                >
                    {icon}
                </span>
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                    <span className="imcrm-text-[10px] imcrm-font-bold imcrm-uppercase imcrm-tracking-[0.08em] imcrm-text-muted-foreground">
                        {overline}
                    </span>
                    <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{title}</span>
                </div>
                {badges}
                {toolbar && (
                    <div
                        className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-0.5"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {toolbar}
                    </div>
                )}
                <ChevronDown
                    className={cn(
                        'imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground imcrm-transition-transform imcrm-duration-150',
                        expanded && 'imcrm-rotate-180',
                    )}
                    aria-hidden
                />
            </header>
            {expanded && (
                <div className="imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-4">
                    {children}
                </div>
            )}
        </section>
    );
}

function IconGhost({
    label,
    onClick,
    disabled,
    children,
}: {
    label: string;
    onClick: () => void;
    disabled?: boolean;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            className="imcrm-h-7 imcrm-w-7 imcrm-text-muted-foreground hover:imcrm-text-foreground"
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={onClick}
        >
            {children}
        </Button>
    );
}

/**
 * Conector vertical entre tarjetas con un botón "+" para insertar una
 * acción exactamente en esa posición del flujo.
 */
function FlowConnector({
    actionsCatalog,
    onInsert,
    terminal,
}: {
    actionsCatalog: ActionMeta[];
    onInsert: (type: string) => void;
    terminal?: boolean;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-items-center" aria-hidden={terminal ? undefined : false}>
            <span className="imcrm-h-3.5 imcrm-w-px imcrm-bg-border" />
            <ActionTypeMenu actionsCatalog={actionsCatalog} onPick={onInsert}>
                <button
                    type="button"
                    className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-card imcrm-text-muted-foreground imcrm-shadow-imcrm-sm imcrm-transition-colors hover:imcrm-border-primary/40 hover:imcrm-text-primary"
                    aria-label={__('Insertar acción aquí')}
                    title={__('Insertar acción aquí')}
                >
                    <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                </button>
            </ActionTypeMenu>
            <span className="imcrm-h-3.5 imcrm-w-px imcrm-bg-border" />
        </div>
    );
}

/**
 * Toggle Flujo (lista vertical) / Lienzo (canvas n8n/Make). El modo se
 * recuerda por navegador — quien arma flujos multi-rama vive en el
 * lienzo; quien hace secuencias simples, en el flujo.
 */
function ModeSwitcher({
    mode,
    onChange,
}: {
    mode: EditorMode;
    onChange: (next: EditorMode) => void;
}): JSX.Element {
    return (
        <div
            className="imcrm-inline-flex imcrm-gap-0.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-canvas imcrm-p-0.5"
            role="tablist"
            aria-label={__('Vista del editor')}
        >
            <button
                type="button"
                role="tab"
                aria-selected={mode === 'flow'}
                onClick={() => onChange('flow')}
                className={cn(
                    'imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1 imcrm-text-[12px] imcrm-font-medium imcrm-transition-colors',
                    mode === 'flow'
                        ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm'
                        : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                )}
            >
                <LayoutList className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Flujo')}
            </button>
            <button
                type="button"
                role="tab"
                aria-selected={mode === 'canvas'}
                onClick={() => onChange('canvas')}
                className={cn(
                    'imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1 imcrm-text-[12px] imcrm-font-medium imcrm-transition-colors',
                    mode === 'canvas'
                        ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm'
                        : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                )}
            >
                <Workflow className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Lienzo')}
            </button>
        </div>
    );
}

function AddActionCard({
    actionsCatalog,
    onInsert,
    isFirst,
}: {
    actionsCatalog: ActionMeta[];
    onInsert: (type: string) => void;
    isFirst: boolean;
}): JSX.Element {
    return (
        <ActionTypeMenu actionsCatalog={actionsCatalog} onPick={onInsert}>
            <button
                type="button"
                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-rounded-2xl imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-canvas imcrm-px-4 imcrm-py-4 imcrm-text-sm imcrm-font-medium imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-border-primary/40 hover:imcrm-text-primary"
            >
                <Plus className="imcrm-h-4 imcrm-w-4" />
                {isFirst ? __('Añadir la primera acción') : __('Añadir acción')}
            </button>
        </ActionTypeMenu>
    );
}

/* ── Estados de carga / error ─────────────────────────────────────── */

function EditorSkeleton(): JSX.Element {
    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-[880px] imcrm-flex-col imcrm-gap-4">
            <div className="imcrm-h-7 imcrm-w-64 imcrm-animate-pulse imcrm-rounded imcrm-bg-muted" />
            <div className="imcrm-h-24 imcrm-animate-pulse imcrm-rounded-2xl imcrm-bg-muted/40" />
            <div className="imcrm-h-24 imcrm-animate-pulse imcrm-rounded-2xl imcrm-bg-muted/40" />
        </div>
    );
}

function NotFoundNote({ text, backTo }: { text: string; backTo: string }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-3">
            <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-4 imcrm-text-sm imcrm-text-destructive">
                {text}
            </div>
            <Button asChild variant="outline" size="sm">
                <Link to={backTo}>{__('Volver')}</Link>
            </Button>
        </div>
    );
}

/**
 * Toggle Activa/Pausada estilo switch — visible y accionable desde el
 * header sin entrar a ningún submenú.
 */
function ActiveTogglePill({
    active,
    onChange,
}: {
    active: boolean;
    onChange: (next: boolean) => void;
}): JSX.Element {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={active}
            onClick={() => onChange(!active)}
            className={cn(
                'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-full imcrm-border imcrm-py-1 imcrm-pl-1.5 imcrm-pr-3 imcrm-text-[12px] imcrm-font-medium imcrm-transition-colors',
                active
                    ? 'imcrm-border-success/30 imcrm-bg-success/10 imcrm-text-success'
                    : 'imcrm-border-border imcrm-bg-muted imcrm-text-muted-foreground',
            )}
        >
            <span
                className={cn(
                    'imcrm-relative imcrm-inline-flex imcrm-h-4 imcrm-w-7 imcrm-items-center imcrm-rounded-full imcrm-transition-colors',
                    active ? 'imcrm-bg-success' : 'imcrm-bg-border',
                )}
                aria-hidden
            >
                <span
                    className={cn(
                        'imcrm-inline-block imcrm-h-3 imcrm-w-3 imcrm-transform imcrm-rounded-full imcrm-bg-white imcrm-shadow imcrm-transition-transform',
                        active ? 'imcrm-translate-x-3.5' : 'imcrm-translate-x-0.5',
                    )}
                />
            </span>
            {active ? __('Activa') : __('Pausada')}
        </button>
    );
}
