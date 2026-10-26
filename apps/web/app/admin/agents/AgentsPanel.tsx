import { Link } from 'react-router';
import { Bot, Loader2, Plus } from 'lucide-react';

import { useAiAgents } from '@/hooks/useAiAgents';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { agentColor, agentIcon } from './agentUi';

const ROW =
    'imcrm-flex imcrm-min-h-10 imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1.5 imcrm-text-[14px] imcrm-transition-colors imcrm-duration-100 lg:imcrm-min-h-0 lg:imcrm-text-[13px]';
const ACTIVE = 'imcrm-bg-background imcrm-font-medium imcrm-text-foreground imcrm-shadow-imcrm-sm imcrm-ring-1 imcrm-ring-border';
const IDLE = 'imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground';

/**
 * E6 — Panel lateral de «Agentes»: todos, uno por uno (con su estado) y
 * «Nuevo agente». Lo usan el panel acoplado y el flotante del riel.
 */
export function AgentsPanel({ pathname }: { pathname: string }): JSX.Element {
    const agents = useAiAgents();
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="agents-panel">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                <Link to="/agents" aria-current={pathname === '/agents' ? 'page' : undefined} className={cn(ROW, pathname === '/agents' ? ACTIVE : IDLE)}>
                    <Bot className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                    <span className="imcrm-truncate">{__('Todos los agentes')}</span>
                </Link>
                <Link to="/agents/new" className={cn(ROW, pathname === '/agents/new' ? ACTIVE : IDLE)}>
                    <Plus className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" aria-hidden />
                    <span className="imcrm-truncate">{__('Nuevo agente')}</span>
                </Link>
            </div>
            {agents.isLoading && <Loader2 className="imcrm-mx-2.5 imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-muted-foreground" />}
            {(agents.data ?? []).length > 0 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <h3 className="imcrm-px-2.5 imcrm-pb-1 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.1em] imcrm-text-muted-foreground">{__('Tus agentes')}</h3>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                        {(agents.data ?? []).map((a) => {
                            const Icon = agentIcon(a.icon);
                            const to = `/agents/${a.id}`;
                            const active = pathname === to;
                            return (
                                <li key={a.id}>
                                    <Link to={to} aria-current={active ? 'page' : undefined} className={cn(ROW, active ? ACTIVE : IDLE)} title={a.paused_reason ?? undefined}>
                                        <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0" style={agentColor(a.color) ? { color: agentColor(a.color) } : undefined} aria-hidden />
                                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{a.name}</span>
                                        {a.pending_proposals > 0 && (
                                            <span className="imcrm-shrink-0 imcrm-rounded-full imcrm-bg-info/15 imcrm-px-1.5 imcrm-text-[10.5px] imcrm-font-medium imcrm-text-[hsl(var(--imcrm-info-ink))]">
                                                {a.pending_proposals}
                                            </span>
                                        )}
                                        <span
                                            aria-label={a.is_active ? __('Activo') : __('En pausa')}
                                            className={cn('imcrm-h-1.5 imcrm-w-1.5 imcrm-shrink-0 imcrm-rounded-full', a.is_active ? 'imcrm-bg-success' : 'imcrm-bg-warning')}
                                        />
                                    </Link>
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}
        </div>
    );
}
