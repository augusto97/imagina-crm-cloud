import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Bot, FlaskConical, History, Loader2, Pause, Play, Save, Settings2, Trash2, Workflow } from 'lucide-react';
import { aiAgentTemplate, type AiAgentDto, type AiAgentQuickTrigger } from '@imagina-base/shared';

import { IconSquare } from '@/admin/lists/FolderBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { useAiAgent, useCreateAiAgent, useDeleteAiAgent, useUpdateAiAgent } from '@/hooks/useAiAgents';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { AgentConfigForm, emptyDraft, type AgentDraft } from './AgentConfigForm';
import { AgentRunsList } from './AgentRuns';
import { AgentTestPanel } from './AgentTestPanel';
import { AgentVersions } from './AgentVersions';
import { AgentWhen } from './AgentWhen';
import { agentColor, agentIcon, shortTokens } from './agentUi';

type Tab = 'config' | 'when' | 'test' | 'runs' | 'versions';
const TABS: readonly Tab[] = ['config', 'when', 'test', 'runs', 'versions'];

function readTab(raw: string | null): Tab {
    return (TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'config';
}

function fromAgent(a: AiAgentDto): AgentDraft {
    return {
        name: a.name,
        description: a.description,
        color: a.color,
        icon: a.icon,
        instructions: a.instructions,
        list_ids: a.list_ids,
        tools: a.tools,
        mode: a.mode,
        client_comments: a.settings.client_comments,
        reviewer_user_ids: a.settings.reviewer_user_ids,
        max_steps: a.max_steps,
        max_runs_per_day: a.max_runs_per_day,
        monthly_token_budget: a.monthly_token_budget,
    };
}

function toInput(d: AgentDraft) {
    return {
        name: d.name.trim(),
        description: d.description.trim(),
        color: d.color,
        icon: d.icon,
        instructions: d.instructions.trim(),
        list_ids: d.list_ids,
        tools: d.tools,
        mode: d.mode,
        settings: { client_comments: d.client_comments, reviewer_user_ids: d.reviewer_user_ids },
        max_steps: d.max_steps,
        max_runs_per_day: d.max_runs_per_day,
        monthly_token_budget: d.monthly_token_budget,
    };
}

function errorsOf(err: unknown): Record<string, string> {
    if (err instanceof ApiError) return Object.keys(err.errors).length > 0 ? err.errors : { _: err.message };
    return { _: err instanceof Error ? err.message : __('No se pudo guardar.') };
}

/**
 * E6 — Crear o editar un agente de IA: «Configuración», «Cuándo trabaja»,
 * «Probar», «Historial» y «Versiones» (las pestañas viven en `?tab=`).
 */
export function AgentEditorPage(): JSX.Element {
    const { agentId } = useParams();
    const id = agentId && /^\d+$/.test(agentId) ? Number(agentId) : undefined;
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    const toast = useToast();
    const confirm = useConfirm();
    const agent = useAiAgent(id);
    const create = useCreateAiAgent();
    const update = useUpdateAiAgent(id ?? 0);
    const remove = useDeleteAiAgent();
    const templateKey = params.get('template');
    const template = useMemo(() => (templateKey ? aiAgentTemplate(templateKey) : null), [templateKey]);
    const isNew = id === undefined;
    const tab: Tab = isNew ? 'config' : readTab(params.get('tab'));

    const [draft, setDraft] = useState<AgentDraft | null>(null);
    const [saved, setSaved] = useState<string>('');
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Arranque: del agente guardado, de la plantilla o en blanco.
    useEffect(() => {
        if (isNew) {
            const base = emptyDraft();
            const d: AgentDraft = template
                ? { ...base, name: template.name, description: template.description, icon: template.icon, color: template.color, instructions: template.instructions, tools: [...template.tools], mode: template.mode }
                : base;
            setDraft(d);
            setSaved(JSON.stringify(d));
        } else if (agent.data) {
            const d = fromAgent(agent.data);
            setDraft(d);
            setSaved(JSON.stringify(d));
        }
        // Sólo al cambiar de agente o de plantilla (no en cada refetch).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isNew, id, templateKey, agent.data?.updated_at]);

    const dirty = draft !== null && JSON.stringify(draft) !== saved;
    useUnsavedChangesGuard(dirty);

    const setTab = (t: Tab): void => {
        const next = new URLSearchParams(params);
        if (t === 'config') next.delete('tab');
        else next.set('tab', t);
        setParams(next, { replace: true });
    };

    const save = (): void => {
        if (!draft) return;
        setErrors({});
        if (isNew) {
            create.mutate(
                { ...toInput(draft), is_active: true, ...(template ? { template_key: template.key } : {}) },
                {
                    onSuccess: (a) => {
                        setSaved(JSON.stringify(draft));
                        toast.success(__('Agente creado'), __('Ahora dile cuándo trabaja o pruébalo sobre un registro.'));
                        const suggest = template?.trigger ? `&suggest=${template.trigger}` : '';
                        navigate(`/agents/${a.id}?tab=when${suggest}`, { replace: true });
                    },
                    onError: (err) => setErrors(errorsOf(err)),
                },
            );
            return;
        }
        update.mutate(toInput(draft), {
            onSuccess: () => {
                setSaved(JSON.stringify(draft));
                toast.success(__('Cambios guardados'));
            },
            onError: (err) => setErrors(errorsOf(err)),
        });
    };

    const toggleActive = (): void => {
        if (!agent.data) return;
        update.mutate(
            { is_active: !agent.data.is_active },
            { onError: (err) => toast.error(__('No se pudo cambiar'), err instanceof Error ? err.message : undefined) },
        );
    };

    const del = async (): Promise<void> => {
        if (!agent.data) return;
        const ok = await confirm({
            title: sprintf(__('¿Borrar el agente «%s»?'), agent.data.name),
            description: __('Las automatizaciones que sólo le pedían trabajo a él van a la papelera y sus propuestas pendientes se descartan. El historial de los registros se conserva.'),
            confirmLabel: __('Borrar'),
            destructive: true,
        });
        if (!ok) return;
        remove.mutate(agent.data.id, {
            onSuccess: () => {
                toast.success(__('Agente borrado'));
                navigate('/agents');
            },
            onError: (err) => toast.error(__('No se pudo borrar'), err instanceof Error ? err.message : undefined),
        });
    };

    if (!isNew && agent.isError) {
        return (
            <div className="imcrm-mx-auto imcrm-max-w-3xl imcrm-py-8 imcrm-text-center">
                <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Ese agente no existe (o lo borraron).')}</p>
                <Link to="/agents" className="imcrm-text-sm imcrm-text-primary hover:imcrm-underline">
                    {__('Volver a los agentes')}
                </Link>
            </div>
        );
    }
    if (draft === null) {
        return (
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-p-4 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando…')}
            </p>
        );
    }

    const a = agent.data;
    const suggested = (params.get('suggest') as AiAgentQuickTrigger | null) ?? null;
    const saving = create.isPending || update.isPending;

    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-4xl imcrm-flex-col imcrm-gap-4 imcrm-py-2" data-testid="agent-editor">
            <Link to="/agents" className="imcrm-flex imcrm-w-fit imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground">
                <ArrowLeft className="imcrm-h-3.5 imcrm-w-3.5" />
                {__('Agentes de IA')}
            </Link>
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                <IconSquare icon={agentIcon(draft.icon)} color={agentColor(draft.color)} size="lg" />
                <div className="imcrm-min-w-[12rem] imcrm-flex-1">
                    <h1 className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-xl imcrm-font-semibold">
                        <span className="imcrm-truncate">{isNew ? (template ? template.name : __('Nuevo agente')) : (a?.name ?? draft.name)}</span>
                        {a && (a.is_active ? <Badge variant="success" dot>{__('Activo')}</Badge> : <Badge variant="warning" dot>{__('En pausa')}</Badge>)}
                    </h1>
                    {a ? (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {a.owner ? sprintf(__('Trabaja con el acceso de %s'), a.owner.name) : __('Sin dueño: guárdalo para que trabaje con tu acceso')}
                            {' · '}
                            {sprintf(__('Hoy: %d corridas'), a.usage.runs_today)}
                            {' · '}
                            {sprintf(__('Este mes: %s tokens'), shortTokens(a.usage.tokens_month))}
                        </p>
                    ) : (
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Trabajará con tu acceso: nunca puede más que tú.')}</p>
                    )}
                </div>
                {a && (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        <Button variant="outline" size="sm" onClick={toggleActive} disabled={update.isPending} data-testid="agent-toggle-active">
                            {a.is_active ? <Pause className="imcrm-h-3.5 imcrm-w-3.5" /> : <Play className="imcrm-h-3.5 imcrm-w-3.5" />}
                            {a.is_active ? __('Pausar') : __('Reanudar')}
                        </Button>
                        <Button variant="ghost" size="sm" className="imcrm-text-destructive" onClick={() => void del()} disabled={remove.isPending}>
                            <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Borrar')}
                        </Button>
                    </div>
                )}
            </header>
            {a && !a.is_active && a.paused_reason && (
                <p className="imcrm-rounded-md imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-[hsl(var(--imcrm-warning-ink))]" data-testid="agent-paused-reason">
                    {a.paused_reason}
                </p>
            )}

            {!isNew && (
                <div role="tablist" className="imcrm-flex imcrm-gap-1 imcrm-overflow-x-auto imcrm-border-b imcrm-border-border">
                    {(
                        [
                            ['config', __('Configuración'), Settings2],
                            ['when', __('Cuándo trabaja'), Workflow],
                            ['test', __('Probar'), FlaskConical],
                            ['runs', __('Historial'), History],
                            ['versions', __('Versiones'), Bot],
                        ] as const
                    ).map(([key, label, Icon]) => (
                        <button
                            key={key}
                            type="button"
                            role="tab"
                            aria-selected={tab === key}
                            onClick={() => setTab(key)}
                            className={cn(
                                '-imcrm-mb-px imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5 imcrm-border-b-2 imcrm-px-3 imcrm-py-2 imcrm-text-sm',
                                tab === key ? 'imcrm-border-primary imcrm-font-medium' : 'imcrm-border-transparent imcrm-text-muted-foreground hover:imcrm-text-foreground',
                            )}
                            data-testid={`agent-tab-${key}`}
                        >
                            <Icon className="imcrm-h-4 imcrm-w-4" />
                            {label}
                            {key === 'when' && a && <span className="imcrm-rounded-full imcrm-bg-muted imcrm-px-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">{a.triggers.length}</span>}
                        </button>
                    ))}
                </div>
            )}

            {tab === 'config' && (
                <>
                    <AgentConfigForm draft={draft} onChange={setDraft} errors={errors} />
                    <div className="imcrm-sticky imcrm-bottom-0 imcrm-z-10 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-bg-background imcrm-py-3">
                        <Button onClick={save} disabled={saving || (!isNew && !dirty)} data-testid="agent-save">
                            {saving ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Save className="imcrm-h-4 imcrm-w-4" />}
                            {isNew ? __('Crear agente') : __('Guardar cambios')}
                        </Button>
                        {dirty && !isNew && <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Tienes cambios sin guardar')}</span>}
                        {errors._ && <span className="imcrm-text-xs imcrm-text-destructive">{errors._}</span>}
                    </div>
                </>
            )}
            {tab === 'when' && a && <AgentWhen agent={a} suggested={suggested} />}
            {tab === 'test' && a && <AgentTestPanel agent={a} />}
            {tab === 'runs' && a && <AgentRunsList agentId={a.id} />}
            {tab === 'versions' && a && <AgentVersions agent={a} />}
        </div>
    );
}
