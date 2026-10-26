import { Link, useNavigate } from 'react-router';
import { Bot, ChevronRight, Loader2, Plus } from 'lucide-react';
import {
    AI_AGENT_MODE_LABELS,
    AI_AGENT_RUN_STATUS_LABELS,
    AI_AGENT_TEMPLATES,
    AI_AGENT_TOOL_META,
    type AiAgentDto,
    type AiAgentTemplate,
} from '@imagina-base/shared';

import { relativeTime } from '@/admin/activity/activityText';
import { IconSquare } from '@/admin/lists/FolderBadge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useAiAgents } from '@/hooks/useAiAgents';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { agentColor, agentIcon, runStatusTone, shortTokens } from './agentUi';

/**
 * E6 — «Agentes de IA»: los agentes de la empresa (estado, dónde y cuándo
 * trabajan, consumo, última corrida y propuestas que esperan) y las plantillas
 * para empezar. Sólo quien tiene `manage_ai_agents` llega aquí.
 */
export function AgentsPage(): JSX.Element {
    const agents = useAiAgents();
    const navigate = useNavigate();
    const list = agents.data ?? [];
    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-5xl imcrm-flex-col imcrm-gap-5 imcrm-py-2" data-testid="agents-page">
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-end imcrm-justify-between imcrm-gap-3">
                <div className="imcrm-min-w-0">
                    <h1 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xl imcrm-font-semibold">
                        <Bot className="imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" />
                        {__('Agentes de IA')}
                    </h1>
                    <p className="imcrm-max-w-2xl imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Compañeros que trabajan solos sobre tus registros: clasifican, resumen, completan datos o asignan, con las herramientas que elijas y nunca con más acceso que quien los crea.')}
                    </p>
                </div>
                <Button onClick={() => navigate('/agents/new')} data-testid="agents-new">
                    <Plus className="imcrm-h-4 imcrm-w-4" />
                    {__('Nuevo agente')}
                </Button>
            </header>

            {agents.isLoading ? (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando…')}
                </p>
            ) : agents.isError ? (
                <p className="imcrm-text-sm imcrm-text-destructive">{__('No se pudieron cargar los agentes.')}</p>
            ) : list.length > 0 ? (
                <Card>
                    <ul className="imcrm-divide-y imcrm-divide-border" data-testid="agents-list">
                        {list.map((a) => (
                            <AgentRow key={a.id} agent={a} />
                        ))}
                    </ul>
                </Card>
            ) : null}

            <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                <h2 className="imcrm-text-sm imcrm-font-semibold">{list.length === 0 ? __('Empieza con una plantilla') : __('Plantillas')}</h2>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Cada plantilla trae la tarea escrita y las herramientas justas. La ajustas a tu lista antes de guardarla.')}
                </p>
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-2 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3" data-testid="agent-templates">
                    {AI_AGENT_TEMPLATES.map((t) => (
                        <TemplateCard key={t.key} template={t} />
                    ))}
                    <Link
                        to="/agents/new"
                        className="imcrm-flex imcrm-min-h-[88px] imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-3 imcrm-text-sm imcrm-text-muted-foreground hover:imcrm-border-primary/50 hover:imcrm-text-foreground"
                    >
                        <Plus className="imcrm-h-4 imcrm-w-4" />
                        {__('En blanco')}
                    </Link>
                </div>
            </section>
        </div>
    );
}

function TemplateCard({ template: t }: { template: AiAgentTemplate }): JSX.Element {
    return (
        <Link
            to={`/agents/new?template=${t.key}`}
            className="imcrm-flex imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3 imcrm-transition-colors hover:imcrm-border-primary/50"
            data-agent-template={t.key}
        >
            <IconSquare icon={agentIcon(t.icon)} color={t.color} size="lg" />
            <div className="imcrm-min-w-0">
                <p className="imcrm-text-sm imcrm-font-medium">{t.name}</p>
                <p className="imcrm-mt-0.5 imcrm-line-clamp-2 imcrm-text-xs imcrm-text-muted-foreground">{t.description}</p>
                <p className="imcrm-mt-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                    {t.tools.map((x) => AI_AGENT_TOOL_META[x].label).join(' · ')}
                </p>
            </div>
        </Link>
    );
}

function AgentRow({ agent: a }: { agent: AiAgentDto }): JSX.Element {
    const where = a.lists.map((l) => l.name).join(', ');
    return (
        <li>
            <Link to={`/agents/${a.id}`} className="imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-px-3 imcrm-py-3 hover:imcrm-bg-muted/40" data-agent-row={a.id}>
                <IconSquare icon={agentIcon(a.icon)} color={agentColor(a.color)} size="lg" />
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1">
                        <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{a.name}</span>
                        {a.is_active ? (
                            <Badge variant="success" dot>
                                {__('Activo')}
                            </Badge>
                        ) : (
                            <Badge variant="warning" dot title={a.paused_reason ?? undefined}>
                                {__('En pausa')}
                            </Badge>
                        )}
                        {a.pending_proposals > 0 && (
                            <Badge variant="info">{sprintf(a.pending_proposals === 1 ? __('%d propuesta') : __('%d propuestas'), a.pending_proposals)}</Badge>
                        )}
                    </div>
                    <p className="imcrm-mt-0.5 imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">
                        {AI_AGENT_MODE_LABELS[a.mode]} · {where || __('sin listas')}
                    </p>
                    {!a.is_active && a.paused_reason && <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-[hsl(var(--imcrm-warning-ink))]">{a.paused_reason}</p>}
                    <p className="imcrm-mt-1 imcrm-flex imcrm-flex-wrap imcrm-gap-x-3 imcrm-gap-y-0.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                        <span>
                            {a.triggers.length === 0
                                ? __('Sin disparadores')
                                : sprintf(a.triggers.length === 1 ? __('%d disparador') : __('%d disparadores'), a.triggers.length)}
                        </span>
                        <span>{sprintf(__('Hoy: %d corridas'), a.usage.runs_today)}</span>
                        <span>
                            {a.monthly_token_budget === null
                                ? sprintf(__('Este mes: %s tokens'), shortTokens(a.usage.tokens_month))
                                : sprintf(__('Este mes: %1$s de %2$s tokens'), shortTokens(a.usage.tokens_month), shortTokens(a.monthly_token_budget))}
                        </span>
                        {a.last_run && (
                            <span className={cn(a.last_run.status === 'failed' && 'imcrm-text-destructive')}>
                                <Badge variant={runStatusTone(a.last_run.status)} className="imcrm-mr-1 imcrm-py-0 imcrm-text-[10.5px]">
                                    {AI_AGENT_RUN_STATUS_LABELS[a.last_run.status]}
                                </Badge>
                                {relativeTime(a.last_run.at)}
                            </span>
                        )}
                    </p>
                </div>
                <ChevronRight className="imcrm-mt-2 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
            </Link>
        </li>
    );
}
