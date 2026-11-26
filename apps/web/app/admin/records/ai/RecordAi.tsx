import { Suspense, useState } from 'react';
import { Link } from 'react-router';
import { Bot, Check, CircleAlert, Clock, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import type { RecordAgentRunDto, RecordAiSummary } from '@imagina-base/shared';

import { relativeTime } from '@/admin/activity/activityText';
import { usePlanModuleOff } from '@/components/PlanModuleNotice';
import { Button } from '@/components/ui/button';
import { aiErrorText, useAiStatus, useRecordAgentRun, useRecordAgents, useRecordAiSummary } from '@/hooks/useRecordAi';
import { useIsGuest } from '@/lib/guest';
import { __, sprintf } from '@/lib/i18n';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { CAP, useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { RecordAction } from '@/admin/records/actions/RecordAction';

/**
 * v0.1.456 (ADR-S109) — ¿Esta persona puede usar la IA en la ficha?
 *
 * `show` decide si se dibuja algo (un invitado o un rol sin «Usar el asistente
 * IA» no ven nada); `reason` dice por qué no se puede usar AHORA (la IA
 * apagada, sin cuota, sin clave o un plan que no la incluye) — el botón se ve
 * y lo explica, en vez de desaparecer sin decir nada.
 */
export function useRecordAiGate(): { show: boolean; ready: boolean; available: boolean; reason: string | null; canConfigure: boolean } {
    const isGuest = useIsGuest();
    const canUse = useCan(CAP.USE_AI_ASSISTANT);
    const planOff = usePlanModuleOff('ai');
    const show = !isGuest && canUse;
    const status = useAiStatus(show && !planOff);
    if (!show) return { show: false, ready: true, available: false, reason: null, canConfigure: false };
    if (planOff) return { show: true, ready: true, available: false, reason: __('Tu plan no incluye la inteligencia artificial.'), canConfigure: false };
    if (status.isError) return { show: true, ready: true, available: false, reason: __('No se pudo revisar si la IA está disponible.'), canConfigure: false };
    if (!status.data) return { show: true, ready: false, available: false, reason: null, canConfigure: false };
    return {
        show: true,
        ready: true,
        available: status.data.available,
        reason: status.data.available ? null : status.data.reason ?? __('La IA no está disponible.'),
        canConfigure: status.data.can_configure,
    };
}

// ── Resumen del registro ─────────────────────────────────────────────────

/**
 * «¿Qué pasó con este cliente?» — el resumen del registro con lo que la persona
 * puede ver (campos, comentarios, actividad, vinculados, checklists, cobros…).
 * Se pide al tocar el botón: un pedido de la cuota, guardado mientras el
 * registro no cambie («Actualizar» vuelve a preguntar).
 */
export function RecordAiSummaryCard({
    listId,
    recordId,
    className,
    bare = false,
}: {
    listId: number;
    recordId: number;
    className?: string;
    /** Dentro de un bloque de la ficha diseñada (el marco lo pone el bloque). */
    bare?: boolean;
}): JSX.Element | null {
    const gate = useRecordAiGate();
    const { summary, ask } = useRecordAiSummary(listId, recordId);
    const [hidden, setHidden] = useState(false);
    if (!gate.show) return null;

    const frame = cn(
        bare ? '' : 'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-3 imcrm-py-2.5',
        className,
    );
    const disabled = !gate.available || ask.isPending;

    if (summary === null || hidden) {
        return (
            <div className={frame} data-testid="imcrm-ai-summary" data-state="idle">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1.5">
                    <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                        {!bare && <Sparkles className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" aria-hidden />}
                        {bare ? (
                            <span className="imcrm-min-w-0 imcrm-text-muted-foreground">{__('Lo que pasó, lo pendiente y lo que viene, en un vistazo.')}</span>
                        ) : (
                            <span className="imcrm-min-w-0">
                                <span className="imcrm-font-medium">{__('Resumen con IA')}</span>
                                <span className="imcrm-hidden imcrm-text-muted-foreground sm:imcrm-inline">
                                    {' · '}
                                    {__('Lo que pasó, lo pendiente y lo que viene, en un vistazo.')}
                                </span>
                            </span>
                        )}
                    </span>
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="imcrm-h-7 imcrm-gap-1.5"
                        disabled={disabled}
                        title={gate.reason ?? undefined}
                        onClick={() => {
                            setHidden(false);
                            ask.mutate(false);
                        }}
                        data-testid="imcrm-ai-summary-run"
                        data-tour="record-ai-summary"
                    >
                        {ask.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Sparkles className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {ask.isPending ? __('Leyendo el registro…') : summary !== null ? __('Mostrar resumen') : __('Resumir con IA')}
                    </Button>
                </div>
                {gate.reason !== null && (
                    <p className="imcrm-mt-1.5 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-ai-summary-reason">
                        {gate.reason}
                        {gate.canConfigure && (
                            <>
                                {' '}
                                <Link to="/settings?s=asistente" className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                                    {__('Configurar la IA')}
                                </Link>
                            </>
                        )}
                    </p>
                )}
                {ask.isError && (
                    <p className="imcrm-mt-1.5 imcrm-text-xs imcrm-text-destructive" role="alert" data-testid="imcrm-ai-summary-error">
                        {aiErrorText(ask.error)}
                    </p>
                )}
            </div>
        );
    }

    return (
        <div className={frame} data-testid="imcrm-ai-summary" data-state="done">
            <SummaryBody summary={summary} />
            {ask.isError && (
                <p className="imcrm-mt-2 imcrm-text-xs imcrm-text-destructive" role="alert" data-testid="imcrm-ai-summary-error">
                    {aiErrorText(ask.error)}
                </p>
            )}
            <div className="imcrm-mt-2.5 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                    <Sparkles className="imcrm-h-3 imcrm-w-3" aria-hidden />
                    {summary.model_name
                        ? sprintf(/* translators: 1: modelo, 2: hace cuánto */ __('Hecho con IA (%1$s) · %2$s'), summary.model_name, relativeTime(summary.generated_at))
                        : sprintf(/* translators: %s: hace cuánto */ __('Hecho con IA · %s'), relativeTime(summary.generated_at))}
                </span>
                <span className="imcrm-flex-1" />
                <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="imcrm-h-7 imcrm-gap-1.5 imcrm-px-2"
                    disabled={disabled}
                    title={gate.reason ?? __('Vuelve a leer el registro y escribe el resumen otra vez.')}
                    onClick={() => ask.mutate(true)}
                    data-testid="imcrm-ai-summary-refresh"
                >
                    {ask.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />}
                    {__('Actualizar')}
                </Button>
                <Button type="button" size="sm" variant="ghost" className="imcrm-h-7 imcrm-px-2" onClick={() => setHidden(true)}>
                    {__('Ocultar')}
                </Button>
            </div>
        </div>
    );
}

function SummaryBody({ summary }: { summary: RecordAiSummary }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-text-sm" data-testid="imcrm-ai-summary-body">
            <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-font-medium imcrm-leading-snug">
                <Sparkles className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" aria-hidden />
                <span>{summary.headline}</span>
            </p>
            <SummaryList items={summary.points} />
            <SummaryList title={__('Pendiente')} items={summary.pending} testId="imcrm-ai-summary-pending" />
            <SummaryList title={__('Lo que viene')} items={summary.next} testId="imcrm-ai-summary-next" />
        </div>
    );
}

function SummaryList({ title, items, testId }: { title?: string; items: string[]; testId?: string }): JSX.Element | null {
    if (items.length === 0) return null;
    return (
        <div data-testid={testId}>
            {title !== undefined && (
                <p className="imcrm-mb-0.5 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{title}</p>
            )}
            <ul className="imcrm-flex imcrm-list-disc imcrm-flex-col imcrm-gap-0.5 imcrm-pl-5 imcrm-text-foreground/90">
                {items.map((it, i) => (
                    <li key={i} className="imcrm-leading-snug">
                        {it}
                    </li>
                ))}
            </ul>
        </div>
    );
}

// ── Pedir al agente ──────────────────────────────────────────────────────

/** El diálogo se baja la primera vez que se abre (no pesa en la ficha). */
const AskAgentDialog = lazyWithReload(() => import('./AskAgentDialog').then((m) => ({ default: m.AskAgentDialog })));

/**
 * «Pedir al agente» — los agentes activos que trabajan en esta lista. Lo usa
 * quien puede usar la IA y editar ESTE registro; el agente igual trabaja con
 * el acceso de su dueño (como desde una automatización). Sin agentes para la
 * lista, o sin poder editar el registro, no se dibuja.
 */
export function RecordAskAgentButton({ listId, recordId, compact = false }: { listId: number; recordId: number; compact?: boolean }): JSX.Element | null {
    const gate = useRecordAiGate();
    const planOff = usePlanModuleOff('ai');
    const state = useRecordAgents(listId, recordId, gate.show && !planOff);
    const [open, setOpen] = useState(false);
    if (!gate.show || planOff || !state.data || !state.data.can_ask || state.data.agents.length === 0) return null;
    const label = __('Pedir al agente');
    return (
        <>
            {compact ? (
                <RecordAction
                    icon={<Bot className="imcrm-h-4 imcrm-w-4" />}
                    label={label}
                    hint={__('Un agente de IA trabaja en este registro con lo que le pidas')}
                    onClick={() => setOpen(true)}
                    data-testid="record-ask-agent"
                    data-tour="record-ask-agent"
                />
            ) : (
                <Button variant="ghost" size="sm" className="imcrm-gap-2" onClick={() => setOpen(true)} data-testid="record-ask-agent" data-tour="record-ask-agent">
                    <Bot className="imcrm-h-4 imcrm-w-4" />
                    <span className="imcrm-hidden sm:imcrm-inline">{label}</span>
                </Button>
            )}
            {open && (
                <Suspense fallback={null}>
                    <AskAgentDialog
                        listId={listId}
                        recordId={recordId}
                        agents={state.data.agents}
                        unavailable={gate.reason}
                        onClose={() => setOpen(false)}
                    />
                </Suspense>
            )}
        </>
    );
}

/** En palabras: en cola, trabajando, terminó (con propuesta / cambios) o falló. */
export function agentRunText(run: RecordAgentRunDto): { tone: 'busy' | 'ok' | 'warn' | 'error'; text: string; detail: string | null } {
    switch (run.status) {
        case 'queued':
            return { tone: 'busy', text: __('En cola: empieza en un momento.'), detail: null };
        case 'running':
            return { tone: 'busy', text: __('Trabajando en el registro…'), detail: null };
        case 'success': {
            const summary = run.summary.trim() === '' ? null : run.summary.trim();
            if (run.proposal !== null && run.proposal.status === 'pending') {
                return {
                    tone: 'ok',
                    text:
                        run.proposal.items === 1
                            ? __('Terminó: dejó una propuesta con 1 cambio para que la revises en la ficha.')
                            : sprintf(/* translators: %d: cambios */ __('Terminó: dejó una propuesta con %d cambios para que la revises en la ficha.'), run.proposal.items),
                    detail: summary,
                };
            }
            if (run.proposal !== null) {
                return { tone: 'ok', text: run.proposal.status === 'applied' ? __('Terminó: su propuesta ya se aplicó.') : __('Terminó: su propuesta ya se revisó.'), detail: summary };
            }
            if (run.writes > 0) {
                return {
                    tone: 'ok',
                    text: run.writes === 1 ? __('Terminó: hizo 1 cambio.') : sprintf(/* translators: %d: cambios */ __('Terminó: hizo %d cambios.'), run.writes),
                    detail: summary,
                };
            }
            return { tone: 'ok', text: __('Terminó sin cambios.'), detail: summary };
        }
        case 'failed':
            return { tone: 'error', text: __('Falló.'), detail: run.error ?? null };
        case 'skipped':
        case 'stopped':
            return { tone: 'warn', text: __('No llegó a trabajar.'), detail: run.error ?? null };
        default:
            return { tone: 'warn', text: String(run.status), detail: null };
    }
}

/** El estado de una corrida, al día (pregunta cada 2 s mientras trabaja). */
export function AgentRunStatus({ listId, recordId, initial }: { listId: number; recordId: number; initial: RecordAgentRunDto }): JSX.Element {
    const q = useRecordAgentRun(listId, recordId, initial.id, initial);
    const run = q.data ?? initial;
    const t = agentRunText(run);
    return (
        <div
            className={cn(
                'imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-px-3 imcrm-py-2 imcrm-text-sm',
                t.tone === 'error'
                    ? 'imcrm-border-destructive/30 imcrm-bg-destructive/5'
                    : t.tone === 'warn'
                      ? 'imcrm-border-warning/30 imcrm-bg-warning/5'
                      : t.tone === 'ok'
                        ? 'imcrm-border-success/25 imcrm-bg-success/5'
                        : 'imcrm-border-border imcrm-bg-muted/40',
            )}
            data-testid="imcrm-agent-run"
            data-status={run.status}
        >
            <span className="imcrm-mt-0.5 imcrm-shrink-0">
                {run.status === 'running' ? (
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-primary" />
                ) : run.status === 'queued' ? (
                    <Clock className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                ) : t.tone === 'ok' ? (
                    <Check className="imcrm-h-4 imcrm-w-4 imcrm-text-[hsl(var(--imcrm-success-ink))]" />
                ) : (
                    <CircleAlert className={cn('imcrm-h-4 imcrm-w-4', t.tone === 'error' ? 'imcrm-text-destructive' : 'imcrm-text-[hsl(var(--imcrm-warning-ink))]')} />
                )}
            </span>
            <span className="imcrm-min-w-0 imcrm-flex-1">
                <span className="imcrm-block">
                    <span className="imcrm-font-medium">{run.agent_name}</span>
                    {' · '}
                    {t.text}
                </span>
                {t.detail !== null && <span className="imcrm-mt-0.5 imcrm-block imcrm-whitespace-pre-line imcrm-text-xs imcrm-text-muted-foreground">{t.detail}</span>}
                <span className="imcrm-mt-0.5 imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">
                    {run.created_by_name
                        ? sprintf(/* translators: 1: persona, 2: hace cuánto */ __('Lo pidió %1$s · %2$s'), run.created_by_name, relativeTime(run.created_at))
                        : relativeTime(run.created_at)}
                </span>
            </span>
        </div>
    );
}

/**
 * Lo que se le pidió hace poco a un agente desde esta ficha (las últimas 24 h),
 * con su estado al día. Sin pedidos recientes no ocupa lugar.
 */
export function RecordAgentRuns({ listId, recordId, className }: { listId: number; recordId: number; className?: string }): JSX.Element | null {
    const gate = useRecordAiGate();
    const planOff = usePlanModuleOff('ai');
    const state = useRecordAgents(listId, recordId, gate.show && !planOff);
    const runs = state.data?.runs ?? [];
    if (!gate.show || planOff || runs.length === 0) return null;
    return (
        <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-1.5', className)} data-testid="imcrm-record-agent-runs">
            {runs.map((r) => (
                <AgentRunStatus key={r.id} listId={listId} recordId={recordId} initial={r} />
            ))}
        </div>
    );
}
