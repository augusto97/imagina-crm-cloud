import { useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronRight, FlaskConical, History, Loader2 } from 'lucide-react';
import { AI_AGENT_RUN_STATUS_LABELS, type AiAgentRunDto } from '@imagina-base/shared';

import { relativeTime } from '@/admin/activity/activityText';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { useAgentRuns } from '@/hooks/useAiAgents';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTime } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';

import { runStatusTone, shortTokens, stepKindLabel, stepKindTone } from './agentUi';

/** Los pasos de una corrida: herramienta, con qué, qué resultó. */
export function RunDetail({ run }: { run: AiAgentRunDto }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="agent-run-detail">
            {run.error && (
                <p className="imcrm-rounded-md imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-px-2.5 imcrm-py-1.5 imcrm-text-xs imcrm-text-[hsl(var(--imcrm-destructive-ink))]">
                    {run.error}
                </p>
            )}
            {run.instruction.trim() !== '' && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    <span className="imcrm-font-medium">{__('Instrucción extra:')}</span> {run.instruction}
                </p>
            )}
            {run.steps.length > 0 ? (
                <ol className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    {run.steps.map((s) => (
                        <li key={s.n} className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs" data-step-kind={s.kind}>
                            <span className="imcrm-mt-0.5 imcrm-w-5 imcrm-shrink-0 imcrm-text-right imcrm-tabular-nums imcrm-text-muted-foreground">{s.n}.</span>
                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                                    <span className="imcrm-font-medium">{s.label}</span>
                                    <Badge variant={stepKindTone(s.kind)} className="imcrm-py-0 imcrm-text-[10.5px]">
                                        {stepKindLabel(s.kind)}
                                    </Badge>
                                    {s.input && <span className="imcrm-truncate imcrm-text-muted-foreground">{s.input}</span>}
                                </div>
                                <p className="imcrm-break-words imcrm-text-muted-foreground">{s.result}</p>
                            </div>
                        </li>
                    ))}
                </ol>
            ) : (
                run.status !== 'queued' && run.status !== 'running' && !run.error && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('No usó herramientas.')}</p>
            )}
            {run.summary.trim() !== '' && (
                <div className="imcrm-rounded-md imcrm-bg-muted/50 imcrm-px-2.5 imcrm-py-2">
                    <p className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Lo que respondió')}</p>
                    <p className="imcrm-mt-0.5 imcrm-whitespace-pre-line imcrm-text-sm">{run.summary}</p>
                </div>
            )}
            {(run.input_tokens > 0 || run.output_tokens > 0) && (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {sprintf(__('Tokens: %1$s de entrada · %2$s de salida'), shortTokens(run.input_tokens), shortTokens(run.output_tokens))}
                </p>
            )}
        </div>
    );
}

/** Estado de una corrida como chip. */
export function RunStatusBadge({ run }: { run: Pick<AiAgentRunDto, 'status'> }): JSX.Element {
    return (
        <Badge variant={runStatusTone(run.status)} dot={run.status === 'running' || run.status === 'queued'} data-run-status={run.status}>
            {AI_AGENT_RUN_STATUS_LABELS[run.status]}
        </Badge>
    );
}

function RunRow({ run }: { run: AiAgentRunDto }): JSX.Element {
    const [open, setOpen] = useState(false);
    const live = run.status === 'queued' || run.status === 'running';
    return (
        <li data-run-id={run.id}>
            <button type="button" onClick={() => setOpen((o) => !o)} className="imcrm-flex imcrm-w-full imcrm-items-start imcrm-gap-2 imcrm-px-3 imcrm-py-2.5 imcrm-text-left hover:imcrm-bg-muted/40" aria-expanded={open}>
                {open ? <ChevronDown className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" /> : <ChevronRight className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />}
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                        <RunStatusBadge run={run} />
                        {run.simulated && (
                            <Badge variant="secondary" className="imcrm-gap-1">
                                <FlaskConical className="imcrm-h-3 imcrm-w-3" />
                                {__('Prueba')}
                            </Badge>
                        )}
                        <span className="imcrm-truncate imcrm-text-sm">{run.record_title ?? (run.record_id ? sprintf(__('Registro #%d'), run.record_id) : __('Sin registro'))}</span>
                        {live && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin imcrm-text-muted-foreground" />}
                    </div>
                    <p className="imcrm-mt-0.5 imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                        {run.trigger_label}
                        {run.list_name ? ` · ${run.list_name}` : ''}
                        {' · '}
                        <span title={formatDateTime(parseUtcDate(run.created_at))}>{relativeTime(run.created_at)}</span>
                        {run.steps.length > 0 ? ` · ${sprintf(run.steps.length === 1 ? __('%d paso') : __('%d pasos'), run.steps.length)}` : ''}
                    </p>
                </div>
            </button>
            {open && (
                <div className="imcrm-px-3 imcrm-pb-3 imcrm-pl-9">
                    {run.list_slug && run.record_id && (
                        <Link to={`/lists/${run.list_slug}/records?record=${run.record_id}`} className="imcrm-mb-2 imcrm-inline-block imcrm-text-xs imcrm-text-primary hover:imcrm-underline">
                            {__('Abrir el registro')}
                        </Link>
                    )}
                    <RunDetail run={run} />
                </div>
            )}
        </li>
    );
}

/** E6 — «Historial»: las corridas del agente, con sus pasos. */
export function AgentRunsList({ agentId }: { agentId: number }): JSX.Element {
    const runs = useAgentRuns(agentId);
    if (runs.isLoading) {
        return (
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando…')}
            </p>
        );
    }
    const data = runs.data ?? [];
    if (data.length === 0) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-6 imcrm-py-10 imcrm-text-center">
                <History className="imcrm-h-6 imcrm-w-6 imcrm-text-muted-foreground" />
                <p className="imcrm-text-sm imcrm-font-medium">{__('Todavía no trabajó')}</p>
                <p className="imcrm-max-w-sm imcrm-text-xs imcrm-text-muted-foreground">{__('Cada vez que le pidan trabajo (o lo pruebes), queda aquí con lo que hizo paso a paso.')}</p>
            </div>
        );
    }
    return (
        <Card>
            <ul className="imcrm-divide-y imcrm-divide-border" data-testid="agent-runs">
                {data.map((r) => (
                    <RunRow key={r.id} run={r} />
                ))}
            </ul>
        </Card>
    );
}
