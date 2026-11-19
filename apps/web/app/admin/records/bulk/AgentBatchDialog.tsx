import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Link } from 'react-router';
import { Bot, Check, CircleAlert, Loader2, Square, X } from 'lucide-react';
import { AI_AGENT_BATCH_MAX, type AgentBatchDto, type AgentBatchPreview, type BulkEditTarget, type RecordAgentOption } from '@imagina-base/shared';

import { agentColor, agentIcon, shortTokens } from '@/admin/agents/agentUi';
import { IconSquare } from '@/admin/lists/FolderBadge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { aiErrorText, useAgentBatch, useAgentBatchPreview, useCancelAgentBatch, useListAgents, useStartAgentBatch } from '@/hooks/useRecordAi';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Texto de cantidad: «1 registro» / «12 registros». */
function records(n: number): string {
    return n === 1 ? __('1 registro') : sprintf(/* translators: %d: cantidad */ __('%d registros'), n);
}

/**
 * v0.1.456 (ADR-S109) — Correr un agente de IA sobre registros que ya existen:
 * la selección o todo lo que coincide con la vista (máximo 200). Antes de
 * arrancar dice cuántos van a correr y qué topes usa (corridas del día del
 * agente, cuota de la IA del plan, presupuesto de tokens); después muestra el
 * avance y el resultado sin recargar. Cada registro es una corrida del agente
 * con el acceso de su dueño; en modo «propone», cada uno deja su propuesta.
 */
export function AgentBatchDialog({
    listId,
    target,
    count,
    onClose,
}: {
    listId: number;
    target: BulkEditTarget;
    /** Cuántos coinciden (lo que muestra la vista), si se sabe. */
    count: number | null;
    onClose: () => void;
}): JSX.Element {
    const [frozenTarget] = useState(target);
    const agents = useListAgents(listId);
    const [agentId, setAgentId] = useState<number | null>(null);
    const [instruction, setInstruction] = useState('');
    const preview = useAgentBatchPreview(listId);
    const start = useStartAgentBatch(listId);
    const [batchId, setBatchId] = useState<number | null>(null);

    // El primero de la lista arranca elegido.
    useEffect(() => {
        if (agentId === null && agents.data && agents.data.length > 0) setAgentId(agents.data[0]!.id);
    }, [agents.data, agentId]);

    // Cada agente tiene sus topes: la vista previa se pide al elegirlo.
    const { mutate: runPreview } = preview;
    useEffect(() => {
        if (agentId !== null) runPreview({ agent_id: agentId, target: frozenTarget });
    }, [agentId, frozenTarget, runPreview]);

    const pv = preview.data && preview.data.agent.id === agentId ? preview.data : null;

    return (
        <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-lg imcrm-overflow-y-auto imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg sm:imcrm-p-6"
                    style={{ transform: 'translate(-50%, -50%)' }}
                    data-testid="imcrm-agent-batch-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                        <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary">
                            <Bot className="imcrm-h-5 imcrm-w-5" />
                        </span>
                        <div className="imcrm-min-w-0 imcrm-flex-1">
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Pedir a un agente')}</Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {'ids' in frozenTarget
                                    ? sprintf(/* translators: %s: «N registros» */ __('El agente trabaja en cada uno de los %s seleccionados.'), records(frozenTarget.ids.length))
                                    : count !== null
                                      ? sprintf(/* translators: %s: «N registros» */ __('El agente trabaja en cada uno de los %s que coinciden con la vista.'), records(count))
                                      : __('El agente trabaja en cada registro que coincide con la vista.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent" aria-label={__('Cerrar')}>
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>

                    {batchId !== null ? (
                        <BatchProgress listId={listId} batchId={batchId} initial={start.data ?? null} onClose={onClose} />
                    ) : agents.isLoading ? (
                        <p className="imcrm-mt-4 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Buscando los agentes de esta lista…')}
                        </p>
                    ) : agents.isError ? (
                        <p className="imcrm-mt-4 imcrm-text-sm imcrm-text-destructive" role="alert">
                            {aiErrorText(agents.error)}
                        </p>
                    ) : (agents.data ?? []).length === 0 ? (
                        <div className="imcrm-mt-4 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-4 imcrm-text-sm" data-testid="imcrm-agent-batch-empty">
                            <p>{__('No hay agentes activos que trabajen en esta lista.')}</p>
                            <Link to="/agents" className="imcrm-mt-1 imcrm-inline-block imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                                {__('Ir a los agentes')}
                            </Link>
                        </div>
                    ) : (
                        <form
                            className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-3"
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (agentId === null || !pv || pv.will_run === 0 || start.isPending) return;
                                start.mutate(
                                    { agent_id: agentId, target: frozenTarget, instruction: instruction.trim() },
                                    { onSuccess: (b) => setBatchId(b.id) },
                                );
                            }}
                        >
                            <AgentPicker agents={agents.data ?? []} value={agentId} onChange={setAgentId} />
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Label htmlFor="agent-batch-instruction">{__('Indicación para esta vez (opcional)')}</Label>
                                <Textarea
                                    id="agent-batch-instruction"
                                    rows={2}
                                    value={instruction}
                                    maxLength={2000}
                                    placeholder={__('Ej.: clasifica la prioridad según el último mensaje del cliente.')}
                                    onChange={(e) => setInstruction(e.target.value)}
                                    data-testid="imcrm-agent-batch-instruction"
                                />
                            </div>
                            <PreviewBox preview={pv} loading={preview.isPending} error={preview.isError ? aiErrorText(preview.error) : null} />
                            {start.isError && (
                                <p className="imcrm-text-xs imcrm-text-destructive" role="alert">
                                    {aiErrorText(start.error)}
                                </p>
                            )}
                            <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                                <Button type="button" variant="ghost" onClick={onClose}>
                                    {__('Cancelar')}
                                </Button>
                                <Button type="submit" className="imcrm-gap-2" disabled={!pv || pv.will_run === 0 || start.isPending} data-testid="imcrm-agent-batch-start">
                                    {start.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Bot className="imcrm-h-4 imcrm-w-4" />}
                                    {pv && pv.will_run > 0
                                        ? sprintf(/* translators: %s: «N registros» */ __('Correr en %s'), records(pv.will_run))
                                        : __('Correr')}
                                </Button>
                            </div>
                        </form>
                    )}
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function AgentPicker({ agents, value, onChange }: { agents: RecordAgentOption[]; value: number | null; onChange: (id: number) => void }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5" role="radiogroup" aria-label={__('Agente')}>
            {agents.map((a) => {
                const on = a.id === value;
                return (
                    <button
                        key={a.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => onChange(a.id)}
                        className={cn(
                            'imcrm-flex imcrm-w-full imcrm-items-start imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-transition-colors',
                            on ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-accent/50',
                        )}
                        data-testid="imcrm-agent-batch-option"
                    >
                        <IconSquare icon={agentIcon(a.icon)} color={agentColor(a.color)} />
                        <span className="imcrm-min-w-0 imcrm-flex-1">
                            <span className="imcrm-block imcrm-text-sm imcrm-font-medium">{a.name}</span>
                            <span className="imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">
                                {a.mode === 'act' ? __('Hace los cambios') : __('Propone y una persona aprueba')}
                            </span>
                        </span>
                        {on && <Check className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" />}
                    </button>
                );
            })}
        </div>
    );
}

/** Cuántos van a correr y qué topes se usan, antes de arrancar. */
function PreviewBox({ preview, loading, error }: { preview: AgentBatchPreview | null; loading: boolean; error: string | null }): JSX.Element | null {
    if (error !== null) {
        return (
            <p className="imcrm-text-xs imcrm-text-destructive" role="alert" data-testid="imcrm-agent-batch-preview-error">
                {error}
            </p>
        );
    }
    if (preview === null) {
        return loading ? (
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> {__('Calculando cuántos van a correr…')}
            </p>
        ) : null;
    }
    const p = preview;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-p-3 imcrm-text-sm" data-testid="imcrm-agent-batch-preview">
            <p className="imcrm-font-medium" data-testid="imcrm-agent-batch-will-run">
                {p.will_run === 0
                    ? __('No se puede correr en ningún registro ahora.')
                    : sprintf(/* translators: %s: «N registros» */ __('Va a trabajar en %s.'), records(p.will_run))}
            </p>
            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                <li>
                    {sprintf(
                        /* translators: 1: coinciden, 2: puedes editar */
                        __('Coinciden %1$d · puedes editar %2$d (máximo %3$d por vez).'),
                        p.matched,
                        p.eligible,
                        AI_AGENT_BATCH_MAX,
                    )}
                </li>
                <li>
                    {sprintf(
                        /* translators: 1: corridas que usa, 2: corridas que quedan hoy */
                        __('Usa %1$d de las %2$d corridas que le quedan hoy al agente.'),
                        p.will_run,
                        p.runs_left_today,
                    )}
                </li>
                <li>
                    {p.quota_left === null
                        ? sprintf(/* translators: %d: pedidos */ __('Cada registro es un pedido a la IA (%d en total); tu empresa no tiene tope este mes.'), p.will_run)
                        : sprintf(
                              /* translators: 1: pedidos que usa, 2: pedidos que quedan */
                              __('Usa %1$d pedidos de la IA del plan (quedan %2$d este mes).'),
                              p.will_run,
                              p.quota_left,
                          )}
                </li>
                {p.tokens_per_run !== null && (
                    <li>
                        {p.budget_left === null
                            ? sprintf(/* translators: %s: tokens */ __('Cada corrida usa unos %s tokens.'), shortTokens(p.tokens_per_run))
                            : sprintf(
                                  /* translators: 1: tokens por corrida, 2: presupuesto que queda */
                                  __('Cada corrida usa unos %1$s tokens (le quedan %2$s este mes).'),
                                  shortTokens(p.tokens_per_run),
                                  shortTokens(p.budget_left),
                              )}
                    </li>
                )}
                <li>
                    {p.agent.mode === 'act'
                        ? __('El agente hace los cambios en cada registro.')
                        : __('El agente deja una propuesta en cada registro; una persona decide si se aplica.')}
                </li>
            </ul>
            {p.notes.length > 0 && (
                <ul className="imcrm-mt-1 imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-text-xs imcrm-text-[hsl(var(--imcrm-warning-ink))]" data-testid="imcrm-agent-batch-notes">
                    {p.notes.map((n, i) => (
                        <li key={i} className="imcrm-flex imcrm-items-start imcrm-gap-1">
                            <CircleAlert className="imcrm-mt-px imcrm-h-3 imcrm-w-3 imcrm-shrink-0" />
                            {n}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/** El avance del lote, al día (sigue en el servidor aunque se cierre la ventana). */
function BatchProgress({ listId, batchId, initial, onClose }: { listId: number; batchId: number; initial: AgentBatchDto | null; onClose: () => void }): JSX.Element {
    const q = useAgentBatch(listId, batchId);
    const cancel = useCancelAgentBatch(listId);
    const b = q.data ?? initial;
    if (b === null) {
        return (
            <p className="imcrm-mt-4 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Arrancando…')}
            </p>
        );
    }
    const done = b.succeeded + b.failed + b.skipped;
    const pct = b.total > 0 ? Math.round((done / b.total) * 100) : 100;
    const running = b.status === 'running';
    return (
        <div className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-agent-batch-progress" data-status={b.status}>
            <div>
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-text-sm">
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium">
                        {running ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-primary" /> : b.status === 'done' ? <Check className="imcrm-h-4 imcrm-w-4 imcrm-text-[hsl(var(--imcrm-success-ink))]" /> : <CircleAlert className="imcrm-h-4 imcrm-w-4 imcrm-text-[hsl(var(--imcrm-warning-ink))]" />}
                        {running
                            ? sprintf(/* translators: %s: agente */ __('«%s» está trabajando…'), b.agent_name)
                            : b.status === 'done'
                              ? sprintf(/* translators: %s: agente */ __('«%s» terminó.'), b.agent_name)
                              : b.status === 'cancelled'
                                ? __('Se detuvo el lote.')
                                : __('El lote se detuvo antes de terminar.')}
                    </span>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-agent-batch-count">
                        {sprintf(/* translators: 1: listos, 2: total */ __('%1$d de %2$d'), done, b.total)}
                    </span>
                </div>
                <div className="imcrm-mt-1.5 imcrm-h-2 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                    <div className="imcrm-h-full imcrm-rounded-full imcrm-bg-primary imcrm-transition-all" style={{ width: `${pct}%` }} />
                </div>
            </div>
            {b.stopped_reason && <p className="imcrm-text-xs imcrm-text-[hsl(var(--imcrm-warning-ink))]">{b.stopped_reason}</p>}
            <dl className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-x-4 imcrm-gap-y-1 imcrm-text-xs sm:imcrm-grid-cols-3">
                <Stat label={__('En cola')} value={b.queued + Math.max(0, b.total - b.dispatched)} />
                <Stat label={__('Trabajando')} value={b.running} />
                <Stat label={__('Terminaron')} value={b.succeeded} />
                <Stat label={__('Fallaron')} value={b.failed} tone={b.failed > 0 ? 'error' : undefined} />
                <Stat label={__('No corrieron')} value={b.skipped} />
                {b.changed > 0 && <Stat label={__('Registros cambiados')} value={b.changed} />}
                {b.proposals_pending > 0 && <Stat label={__('Propuestas por revisar')} value={b.proposals_pending} />}
            </dl>
            {b.proposals_pending > 0 && !running && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Las propuestas se revisan en la ficha de cada registro o en «Mi trabajo» → Agentes.')}
                </p>
            )}
            {b.errors.length > 0 && (
                <ul className="imcrm-flex imcrm-max-h-40 imcrm-flex-col imcrm-gap-1 imcrm-overflow-y-auto imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-2 imcrm-text-xs" data-testid="imcrm-agent-batch-errors">
                    {b.errors.map((e, i) => (
                        <li key={i}>
                            <span className="imcrm-font-medium">{e.title}</span>
                            {': '}
                            <span className="imcrm-text-muted-foreground">{e.message}</span>
                        </li>
                    ))}
                </ul>
            )}
            {running && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Sigue trabajando aunque cierres esta ventana.')}</p>
            )}
            <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                {running && (
                    <Button
                        type="button"
                        variant="outline"
                        className="imcrm-gap-2"
                        disabled={cancel.isPending}
                        onClick={() => cancel.mutate(batchId)}
                        data-testid="imcrm-agent-batch-cancel"
                    >
                        <Square className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Detener')}
                    </Button>
                )}
                <Button type="button" onClick={onClose} data-testid="imcrm-agent-batch-close">
                    {running ? __('Cerrar') : __('Listo')}
                </Button>
            </div>
        </div>
    );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'error' }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-gap-2">
            <dt className="imcrm-text-muted-foreground">{label}</dt>
            <dd className={cn('imcrm-font-semibold imcrm-tabular-nums', tone === 'error' && 'imcrm-text-destructive')}>{value}</dd>
        </div>
    );
}
