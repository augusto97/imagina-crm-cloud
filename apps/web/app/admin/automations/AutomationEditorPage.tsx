import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import {
    AlertCircle,
    ArrowDown,
    ArrowLeft,
    ArrowUp,
    ChevronDown,
    Copy,
    CopyPlus,
    FlaskConical,
    GitCommitVertical,
    History,
    LayoutList,
    Loader2,
    Play,
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
    useDuplicateAutomation,
    useTriggerCatalog,
    useUpdateAutomation,
} from '@/hooks/useAutomations';
import { useRelationPaths } from '@/hooks/useRelationPaths';
import { useFields } from '@/hooks/useFields';
import { useList, useLists } from '@/hooks/useLists';
import { api, ApiError } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { automationConfigIssues, type AutomationConfigIssue, type AutomationVersion } from '@imagina-base/shared';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { automationsKeys } from '@/hooks/useAutomations';
import { __, _n, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';
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
    AutomationEditorAutomationContext,
    AutomationEditorListContext,
    withScheduleZone,
    cleanTriggerConfig,
    EMPTY_AUTOMATION_STATE,
    fromAutomation,
    helpForTrigger,
    TriggerConfigEditor,
    type AutomationFormState,
} from './config-editors';
import { ActionTypeSelect } from './ActionTypeSelect';
import { AutomationTestPanel } from './AutomationTestPanel';
import { AutomationVersionsSheet, versionHasSecrets } from './AutomationVersionsSheet';
import { AutomationFlowContext, StepScope, type AutomationFlowValue } from './flowContext';

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
    // v0.1.161 — "Automatizar" desde el menú de una columna llega con el
    // campo YA elegido: abrir el editor vacío con el trigger por defecto no
    // le servía a nadie (reporte del usuario). `?action=update_field&field=`
    // arma la acción con ese campo, como el "Establecer campo personalizado"
    // de ClickUp.
    const [searchParams] = useSearchParams();
    // v0.1.167 — una receta de la galería llega YA armada por el state de la
    // navegación (los roles ya mapeados a los slugs de esta lista): el
    // editor arranca con ella y la persona la revisa antes de guardar.
    const location = useLocation();
    const statePreset = (location.state as { preset?: AutomationFormState } | null)?.preset ?? null;
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

    // `fields` entra en la espera a propósito: `presetFromQuery` resuelve el
    // campo de la URL contra el catálogo, y el estado inicial del editor se
    // fija UNA vez (useState + key) — montar con los campos a medio cargar
    // dejaría la automatización vacía para siempre.
    if (
        list.isLoading
        || (editId !== undefined && automations.isLoading)
        || triggers.isLoading
        || actionsCatalog.isLoading
        || fields.isLoading
    ) {
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
            preset={
                isNew
                    ? statePreset ?? presetFromQuery(searchParams, fields.data ?? [])
                    : null
            }
        />
    );
}

/**
 * Estado inicial derivado de la URL, para las entradas "desde el contexto"
 * (hoy: el menú de una columna). Sin parámetros devuelve `null` y el editor
 * arranca como siempre.
 */
function presetFromQuery(
    params: URLSearchParams,
    fields: FieldEntity[],
): AutomationFormState | null {
    // Campo «Botón» — «Automatizar» desde su columna o su editor: el
    // disparador «Al presionar el botón» ya apuntado a ese botón.
    if (params.get('trigger') === 'button_pressed') {
        const buttonId = Number(params.get('button') ?? '');
        const button = fields.find((f) => f.id === buttonId && f.type === 'button');
        return {
            ...EMPTY_AUTOMATION_STATE,
            name: button
                ? sprintf(
                      /* translators: %s: nombre del botón */
                      __('Al presionar «%s»'),
                      button.label,
                  )
                : __('Al presionar el botón'),
            triggerType: 'button_pressed',
            triggerConfig: button ? { button_field_id: button.id } : {},
        };
    }
    if (params.get('action') !== 'update_field') return null;
    const fieldId = Number(params.get('field') ?? '');
    const field = fields.find((f) => f.id === fieldId);
    if (!field) return null;
    return {
        ...EMPTY_AUTOMATION_STATE,
        name: sprintf(
            /* translators: %s: nombre del campo */
            __('Establecer «%s»'),
            field.label,
        ),
        actions: [{ type: 'update_field', config: { values: { [field.slug]: '' } } }],
    };
}

function EditorBody({
    list,
    editing,
    triggers,
    actionsCatalog,
    fields,
    lists,
    preset,
}: {
    list: ListSummary;
    editing: AutomationEntity | null;
    triggers: TriggerMeta[];
    actionsCatalog: ActionMeta[];
    fields: FieldEntity[];
    lists: ListSummary[];
    /** Estado inicial derivado de la URL (ver `presetFromQuery`). */
    preset?: AutomationFormState | null;
}): JSX.Element {
    const navigate = useNavigate();
    const toast = useToast();
    const create = useCreateAutomation(list.id);
    const update = useUpdateAutomation(list.id);

    const [state, setState] = useState<AutomationFormState>(() =>
        editing ? fromAutomation(editing) : (preset ?? EMPTY_AUTOMATION_STATE),
    );
    const [error, setError] = useState<string | null>(null);
    const [runsOpen, setRunsOpen] = useState(false);
    // v0.1.288 — «Probar» paso a paso, historial de versiones y duplicar.
    const [testOpen, setTestOpen] = useState(false);
    const [versionsOpen, setVersionsOpen] = useState(false);
    const [restored, setRestored] = useState<{ id: number; at: string; secrets: boolean } | null>(null);
    const duplicate = useDuplicateAutomation(list.id);
    const relationPaths = useRelationPaths(list.id);
    // Respuestas reales (de «Probar» o del probador de un webhook) por ruta
    // del paso: el selector de variables sugiere sus rutas en los pasos de abajo.
    const [samples, setSamples] = useState<Record<string, unknown>>({});
    // v0.1.221 — «Ejecutar ahora» de una automatización programada.
    const [runningNow, setRunningNow] = useState(false);
    const qc = useQueryClient();
    const runNow = async (): Promise<void> => {
        if (!editing) return;
        setRunningNow(true);
        try {
            await api.post(`/lists/${list.id}/automations/${editing.id}/run`, {});
            toast.success(__('En marcha: el resultado aparece en el historial en unos segundos.'));
            // v0.1.252 — el historial se refresca solo: abierto en la misma
            // sesión mostraba «Aún no hay ejecuciones» hasta recargar.
            const refreshRuns = (): void => void qc.invalidateQueries({ queryKey: [...automationsKeys.all, 'runs'] });
            window.setTimeout(() => { refreshRuns(); setRunsOpen(true); }, 1500);
            window.setTimeout(refreshRuns, 5000);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : __('No se pudo ejecutar.'));
        } finally {
            setRunningNow(false);
        }
    };
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
        // Con preset, la acción ya cargada arranca ABIERTA: es lo que el
        // usuario viene a completar (el valor a poner en el campo).
        () => new Set(editing ? [] : preset ? ['trigger', 'action-0'] : ['trigger']),
    );

    const initialJson = useRef(JSON.stringify(editing ? fromAutomation(editing) : EMPTY_AUTOMATION_STATE));
    const dirty = JSON.stringify(state) !== initialJson.current;

    // Cambios sin guardar: cerrar la pestaña, un enlace de la app (la flecha
    // de volver, el menú) o «Atrás» del navegador piden confirmación.
    useUnsavedChangesGuard(dirty, __('Tienes cambios sin guardar en esta automatización. Si sales ahora, se pierden.'));

    // Lo que le falta para poder correr (la MISMA validación que el servidor
    // al guardar). Se muestra en cada tarjeta después de intentar guardar.
    const [showIssues, setShowIssues] = useState(false);
    const issues = useMemo(
        () =>
            automationConfigIssues({
                trigger_type: state.triggerType,
                trigger_config: cleanTriggerConfig(state.triggerConfig),
                actions: state.actions,
            }),
        [state.triggerType, state.triggerConfig, state.actions],
    );
    const visibleIssues = showIssues && state.isActive ? issues : [];
    const issuesFor = (prefix: string): string[] =>
        visibleIssues.filter((i) => i.path.startsWith(prefix)).map((i) => describeIssue(i, prefix));

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

    const insertAction = (index: number, type: string, config?: Record<string, unknown>): void => {
        const next = [...state.actions];
        next.splice(index, 0, { type, config: config ?? {} });
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
            setError(__('Agrega al menos una acción: sin acciones la automatización no hace nada.'));
            return;
        }

        if (state.isActive && issues.length > 0) {
            setShowIssues(true);
            setError(
                issues.length === 1
                    ? sprintf(__('%s Complétalo o guárdala pausada.'), describeIssue(issues[0]!, ''))
                    : __('A la automatización le faltan algunas cosas para poder correr (están marcadas en cada paso). Complétalas o guárdala pausada.'),
            );
            // Abrir las tarjetas que tienen algo que completar.
            setExpanded((prev) => {
                const next = new Set(prev);
                for (const i of issues) {
                    if (i.path.startsWith('trigger_config')) next.add('trigger');
                    const m = /^actions\.(\d+)\./.exec(i.path);
                    if (m) next.add(`action-${m[1]}`);
                }
                return next;
            });
            window.scrollTo({ top: 0, behavior: 'smooth' });
            return;
        }

        const payload: CreateAutomationInput = {
            name: state.name.trim(),
            description: state.description.trim() === '' ? null : state.description.trim(),
            trigger_type: state.triggerType,
            // v0.1.263 — sin zona propia corre en la de la empresa; sólo si la
            // empresa todavía no eligió, se usa la del navegador (nunca UTC).
            trigger_config:
                state.triggerType === 'scheduled'
                    ? cleanTriggerConfig(withScheduleZone(state.triggerConfig))
                    : cleanTriggerConfig(state.triggerConfig),
            actions: state.actions,
            is_active: state.isActive,
        };

        try {
            if (editing) {
                const updated = await update.mutateAsync({
                    id: editing.id,
                    input: restored ? { ...payload, restored_from: restored.id } : payload,
                });
                setRestored(null);
                // v0.1.110 — el backend puede generar/rotar el token del
                // webhook entrante al guardar: reflejarlo sin recargar.
                const serverToken = updated?.trigger_config?.webhook_token;
                const nextState =
                    typeof serverToken === 'string' && serverToken !== state.triggerConfig.webhook_token
                        ? { ...state, triggerConfig: { ...state.triggerConfig, webhook_token: serverToken } }
                        : state;
                setState(nextState);
                initialJson.current = JSON.stringify(nextState);
                toast.success(__('Automatización guardada'));
            } else {
                const created = await create.mutateAsync(payload);
                toast.success(__('Automatización creada'));
                navigate(`/lists/${list.slug}/automations/${created.id}`, { replace: true });
            }
        } catch (err) {
            if (err instanceof ApiError) {
                const entries = Object.entries(err.errors);
                // Lo que falta por paso se marca en las tarjetas; el resto, en el aviso.
                if (entries.some(([path]) => path.startsWith('actions.') || path.startsWith('trigger_config'))) setShowIssues(true);
                const detail = entries
                    .map(([path, msg]) => `${describeIssue({ path, message: String(msg) }, '')}`)
                    .join(' · ');
                setError(detail !== '' && detail !== err.message ? `${err.message} — ${detail}` : err.message);
            } else if (err instanceof Error) {
                setError(err.message);
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    };

    const isPending = create.isPending || update.isPending;
    const triggerMeta = triggerMetaFor(state.triggerType);
    const triggerFilters = triggerConditionCount(state.triggerConfig);

    const flowValue = useMemo<AutomationFlowValue>(
        () => ({
            actions: state.actions,
            triggerType: state.triggerType,
            samples,
            setSample: (path, body) => setSamples((prev) => ({ ...prev, [path]: body })),
        }),
        [state.actions, state.triggerType, samples],
    );

    const restoreVersion = (v: AutomationVersion): void => {
        setState((s) => ({
            ...s,
            name: v.name,
            description: v.description ?? '',
            triggerType: v.trigger_type,
            triggerConfig: { ...v.trigger_config },
            actions: (v.actions as ActionSpec[]).map((a) => JSON.parse(JSON.stringify(a)) as ActionSpec),
            isActive: v.is_active,
        }));
        setRestored({ id: v.id, at: v.created_at, secrets: versionHasSecrets(v) });
        setExpanded(new Set());
        setError(null);
        toast.success(__('Versión cargada en el editor: revísala y guarda para aplicarla.'));
    };

    const duplicateThis = async (): Promise<void> => {
        if (!editing) return;
        try {
            const copy = await duplicate.mutateAsync(editing.id);
            // La copia entra al cache ANTES de navegar: si no, el editor la
            // buscaría en el listado viejo y diría «no encontrada».
            qc.setQueryData<AutomationEntity[]>(automationsKeys.forList(list.id), (old) =>
                old ? [...old.filter((a) => a.id !== copy.id), copy] : [copy],
            );
            toast.success(__('Copia creada. Quedó pausada: actívala cuando esté lista.'));
            navigate(`/lists/${list.slug}/automations/${copy.id}`);
        } catch (err) {
            toast.error(err instanceof Error ? err.message : __('No se pudo duplicar.'));
        }
    };

    const waitingRuns = editing?.waiting_runs ?? 0;

    return (
        <AutomationEditorListContext.Provider value={list.id}>
        <AutomationEditorAutomationContext.Provider value={editing?.id}>
        <AutomationFlowContext.Provider value={flowValue}>
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
                        {/* El nombre ocupa su propia fila: con Probar, Historial,
                            Versiones y Duplicar al lado quedaba recortado (antes en el
                            celular se aplastaba a ~45px). */}
                        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-basis-full imcrm-flex-col imcrm-gap-0.5">
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
                                placeholder={__('Agrega una descripción (opcional)…')}
                                aria-label={__('Descripción')}
                                className="imcrm-w-full imcrm-border-0 imcrm-bg-transparent imcrm-p-0 imcrm-text-[13px] imcrm-text-muted-foreground imcrm-outline-none placeholder:imcrm-text-muted-foreground/40 focus:imcrm-ring-0"
                            />
                        </div>

                        {/* v0.1.252 — envuelve en el celular (antes «Guardar» quedaba fuera de la pantalla). */}
                        <div className="imcrm-flex imcrm-max-w-full imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                            <ModeSwitcher mode={mode} onChange={switchMode} />
                            <ActiveTogglePill
                                active={state.isActive}
                                onChange={(next) => setState((s) => ({ ...s, isActive: next }))}
                            />
                            {editing && editing.trigger_type === 'scheduled' && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="imcrm-gap-1.5"
                                    onClick={() => void runNow()}
                                    disabled={runningNow || dirty}
                                    title={dirty ? __('Guarda los cambios antes de ejecutar.') : __('Corre ahora, sin esperar al horario.')}
                                    data-testid="imcrm-automation-run-now"
                                >
                                    {runningNow ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Play className="imcrm-h-3.5 imcrm-w-3.5" />}
                                    {__('Ejecutar ahora')}
                                </Button>
                            )}
                            <Button
                                variant="outline"
                                size="sm"
                                className="imcrm-gap-1.5"
                                onClick={() => setTestOpen(true)}
                                aria-label={__('Probar')}
                                title={__('Probar paso a paso con un registro real, sin enviar ni cambiar nada')}
                                data-testid="imcrm-automation-test"
                            >
                                <FlaskConical className="imcrm-h-3.5 imcrm-w-3.5" />
                                <span className="imcrm-hidden sm:imcrm-inline">{__('Probar')}</span>
                            </Button>
                            {editing && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="imcrm-gap-1.5"
                                    onClick={() => setRunsOpen(true)}
                                    aria-label={__('Historial')}
                                    title={__('Historial')}
                                >
                                    <History className="imcrm-h-3.5 imcrm-w-3.5" />
                                    <span className="imcrm-hidden sm:imcrm-inline">{__('Historial')}</span>
                                </Button>
                            )}
                            {editing && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="imcrm-gap-1.5"
                                    onClick={() => setVersionsOpen(true)}
                                    aria-label={__('Versiones')}
                                    title={__('Versiones guardadas')}
                                    data-testid="imcrm-automation-versions"
                                >
                                    <GitCommitVertical className="imcrm-h-3.5 imcrm-w-3.5" />
                                    <span className="imcrm-hidden sm:imcrm-inline">{__('Versiones')}</span>
                                </Button>
                            )}
                            {editing && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="imcrm-gap-1.5"
                                    onClick={() => void duplicateThis()}
                                    disabled={duplicate.isPending || dirty}
                                    aria-label={__('Duplicar')}
                                    title={dirty ? __('Guarda los cambios antes de duplicar.') : __('Crea una copia pausada')}
                                    data-testid="imcrm-automation-duplicate"
                                >
                                    <CopyPlus className="imcrm-h-3.5 imcrm-w-3.5" />
                                    <span className="imcrm-hidden lg:imcrm-inline">{__('Duplicar')}</span>
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
                    {restored && (
                        <p className="imcrm-rounded-md imcrm-border imcrm-border-info/30 imcrm-bg-info/5 imcrm-px-3 imcrm-py-2 imcrm-text-[12px]" data-testid="imcrm-restored-note">
                            {sprintf(__('Cargaste la versión del %s. Revísala y guarda para aplicarla (queda en el historial).'), formatVersionDate(restored.at))}
                            {restored.secrets && ` ${__('Los secretos no se guardan en las versiones: al guardar se conservan los actuales de cada paso.')}`}
                        </p>
                    )}
                    {editing && editing.is_active && !state.isActive && waitingRuns > 0 && (
                        <p className="imcrm-rounded-md imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-[12px]" data-testid="imcrm-pause-waiting-note">
                            {sprintf(
                                _n(
                                    'Hay %d corrida en espera: al guardarla pausada se cancela y no se retoma al reactivarla.',
                                    'Hay %d corridas en espera: al guardarla pausada se cancelan y no se retoman al reactivarla.',
                                    waitingRuns,
                                ),
                                waitingRuns,
                            )}
                        </p>
                    )}
                </header>

                {error && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-p-3 imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-automation-error">
                        <AlertCircle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                        <span className="imcrm-min-w-0 imcrm-flex-1">{error}</span>
                        {visibleIssues.length > 0 && (
                            <Button
                                size="sm"
                                variant="outline"
                                className="imcrm-shrink-0"
                                onClick={() => {
                                    setState((s) => ({ ...s, isActive: false }));
                                    setError(null);
                                }}
                            >
                                {__('Dejarla pausada')}
                            </Button>
                        )}
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
                                relationPaths={relationPaths.data}
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
                                        _n('%d condición', '%d condiciones', triggerFilters),
                                        triggerFilters,
                                    )}
                                </Badge>
                            ) : undefined
                        }
                        expanded={expanded.has('trigger')}
                        onToggle={() => toggleCard('trigger')}
                        issues={issuesFor('trigger_config')}
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
                                aria-label={__('Disparador')}
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
                                    onInsert={(type, config) => insertAction(i, type, config)}
                                />
                                <FlowCard
                                    tone="neutral"
                                    overline={sprintf(
                                        /* translators: %d: step number */
                                        __('Paso %d'),
                                        i + 1,
                                    )}
                                    icon={<meta.icon className="imcrm-h-4 imcrm-w-4" />}
                                    title={summarizeAction(spec, fields, lists, actionsCatalog, relationPaths.data)}
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
                                    issues={issuesFor(`actions.${i}.`)}
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
                                    <StepScope path={[i]}>
                                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                                        <ActionTypeSelect
                                            spec={spec}
                                            actionsCatalog={actionsCatalog}
                                            onChange={(picked) => {
                                                const next = [...state.actions];
                                                next[i] = picked;
                                                setActions(next);
                                            }}
                                        />
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
                                    </StepScope>
                                </FlowCard>
                            </div>
                        );
                    })}

                    {/* Añadir al final */}
                    <FlowConnector
                        actionsCatalog={actionsCatalog}
                        onInsert={(type, config) => insertAction(state.actions.length, type, config)}
                        terminal
                    />
                    <AddActionCard
                        actionsCatalog={actionsCatalog}
                        onInsert={(type, config) => insertAction(state.actions.length, type, config)}
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
            {editing && (
                <AutomationVersionsSheet
                    open={versionsOpen}
                    onOpenChange={setVersionsOpen}
                    listId={list.id}
                    automationId={editing.id}
                    fields={fields}
                    lists={lists}
                    catalog={actionsCatalog}
                    relationPaths={relationPaths.data}
                    onRestore={restoreVersion}
                />
            )}
            <AutomationTestPanel
                open={testOpen}
                onOpenChange={setTestOpen}
                listId={list.id}
                automationId={editing?.id}
                triggerType={state.triggerType}
                triggerConfig={cleanTriggerConfig(state.triggerConfig)}
                actions={state.actions}
                fields={fields}
                actionsCatalog={actionsCatalog}
                onResponses={(responses) => setSamples((prev) => ({ ...prev, ...responses }))}
            />
        </AutomationFlowContext.Provider>
        </AutomationEditorAutomationContext.Provider>
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
    issues = [],
    children,
}: {
    /** Lo que le falta a este paso para poder correr (se ve aunque esté plegado). */
    issues?: string[];
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
            {issues.length > 0 && (
                <ul className="imcrm-mx-4 imcrm-mb-3 imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-[12px] imcrm-text-destructive" data-testid="imcrm-step-issues">
                    {issues.map((m) => (
                        <li key={m} className="imcrm-flex imcrm-items-start imcrm-gap-1.5">
                            <AlertCircle className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                            <span>{m}</span>
                        </li>
                    ))}
                </ul>
            )}
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
    onInsert: (type: string, config?: Record<string, unknown>) => void;
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
    onInsert: (type: string, config?: Record<string, unknown>) => void;
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

/**
 * Un faltante con su ubicación legible: «Paso 2: …», «Paso 1 › Sí › paso 1: …».
 * `prefix` es lo que ya ubica la tarjeta donde se muestra (no se repite).
 */
function describeIssue(issue: AutomationConfigIssue, prefix: string): string {
    const rest = issue.path.startsWith(prefix) ? issue.path.slice(prefix.length) : issue.path;
    const parts: string[] = [];
    const re = /(?:^|\.)(config\.)?(actions|then_actions|else_actions)\.(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(rest)) !== null) {
        const n = Number(m[3]) + 1;
        // v0.1.288 — `config.actions` es el cuerpo de una repetición.
        if (m[2] === 'actions') parts.push(m[1] ? sprintf(__('repetición, paso %d'), n) : sprintf(__('Paso %d'), n));
        else parts.push(sprintf(m[2] === 'then_actions' ? __('rama «Sí», paso %d') : __('rama «No», paso %d'), n));
    }
    if (parts.length === 0 && rest.startsWith('trigger_config') && prefix === '') parts.push(__('Disparador'));
    return parts.length > 0 ? `${parts.join(' › ')}: ${issue.message}` : issue.message;
}

function formatVersionDate(iso: string): string {
    return formatDateTime(parseUtcDate(iso));
}
