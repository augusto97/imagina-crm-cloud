import { Link } from 'react-router';
import { Bot, Check, Loader2, X } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { AiAgentProposalDto, MyAgentProposalsDto } from '@imagina-base/shared';

import { relativeTime } from '@/admin/activity/activityText';
import { IconSquare } from '@/admin/lists/FolderBadge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useToast } from '@/components/ui/toast';
import { useApplyAgentProposal, useDiscardAgentProposal, useRecordAgentProposals } from '@/hooks/useAiAgents';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTime } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';
import { cn } from '@/lib/utils';

import { agentColor, agentIcon } from './agentUi';

function errText(err: unknown): string {
    return err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo guardar.');
}

/**
 * E6 — Una propuesta de un agente de IA: qué quiere cambiar (campo: antes →
 * después, la nota, el registro nuevo…) con Aplicar / Descartar. Aplicar corre
 * con el acceso de quien aplica; lo que cambió desde que se propuso se saltea
 * (lo dice el aviso).
 */
export function AgentProposalCard({
    proposal,
    compact = false,
    readOnly = false,
    showRecord = false,
}: {
    proposal: AiAgentProposalDto;
    compact?: boolean;
    readOnly?: boolean;
    /** «Mi trabajo»: muestra el registro y la lista arriba. */
    showRecord?: boolean;
}): JSX.Element {
    const apply = useApplyAgentProposal();
    const discard = useDiscardAgentProposal();
    const toast = useToast();
    const busy = apply.isPending || discard.isPending;
    const agentName = proposal.agent?.name ?? __('Un agente de IA');

    const onApply = (): void => {
        apply.mutate(proposal.id, {
            onSuccess: (res) => {
                if (res.failed > 0 || res.warnings.length > 0) {
                    const desc = res.warnings.join(' · ') || undefined;
                    if (res.applied > 0) toast.warning(__('Se aplicó una parte'), desc);
                    else toast.error(__('No se pudo aplicar'), desc);
                } else {
                    toast.success(__('Propuesta aplicada'));
                }
            },
            onError: (err) => toast.error(__('No se pudo aplicar'), errText(err)),
        });
    };
    const onDiscard = (): void => {
        discard.mutate(proposal.id, {
            onSuccess: () => toast.info(__('Propuesta descartada')),
            onError: (err) => toast.error(__('No se pudo descartar'), errText(err)),
        });
    };

    return (
        <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2', compact ? 'imcrm-px-3 imcrm-py-3' : '')} data-agent-proposal={proposal.id}>
            {showRecord && (
                <div className="imcrm-min-w-0">
                    <Link
                        to={proposal.list_slug ? `/lists/${proposal.list_slug}/records?record=${proposal.record_id}` : '#'}
                        className="imcrm-block imcrm-truncate imcrm-text-sm imcrm-font-medium hover:imcrm-underline"
                    >
                        {proposal.record_title ?? sprintf(__('Registro #%d'), proposal.record_id)}
                    </Link>
                    {proposal.list_name && <p className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">{proposal.list_name}</p>}
                </div>
            )}
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <IconSquare icon={agentIcon(proposal.agent?.icon)} color={agentColor(proposal.agent?.color)} size="sm" />
                <p className="imcrm-min-w-0 imcrm-flex-1 imcrm-text-sm">
                    <span className="imcrm-font-medium">{agentName}</span>{' '}
                    <span className="imcrm-text-muted-foreground">
                        {proposal.items.length === 1 ? __('propone un cambio') : sprintf(__('propone %d cambios'), proposal.items.length)}
                    </span>
                </p>
                <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground" title={formatDateTime(parseUtcDate(proposal.created_at))}>
                    {relativeTime(proposal.created_at)}
                </span>
            </div>
            {proposal.summary.trim() !== '' && <p className="imcrm-whitespace-pre-line imcrm-text-xs imcrm-text-muted-foreground">{proposal.summary}</p>}
            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                {proposal.items.map((item, i) => (
                    <li key={i} className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2.5 imcrm-py-2">
                        <p className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{item.title}</p>
                        <ul className="imcrm-mt-1 imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                            {item.lines.map((l, k) => (
                                <li key={k} className="imcrm-break-words imcrm-text-sm">
                                    {l.from !== null ? (
                                        <>
                                            <span className="imcrm-text-muted-foreground">{l.label}: </span>
                                            <span className="imcrm-text-muted-foreground imcrm-line-through">{l.from}</span>
                                            <span className="imcrm-mx-1 imcrm-text-muted-foreground">→</span>
                                            <span className="imcrm-font-medium">{l.to}</span>
                                        </>
                                    ) : l.label === item.title ? (
                                        <span className="imcrm-whitespace-pre-line">{l.to}</span>
                                    ) : (
                                        <>
                                            <span className="imcrm-text-muted-foreground">{l.label}: </span>
                                            <span className="imcrm-whitespace-pre-line">{l.to}</span>
                                        </>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </li>
                ))}
            </ul>
            {!readOnly && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                    <Button size="sm" onClick={onApply} disabled={busy} data-testid="agent-proposal-apply">
                        {apply.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Check className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {__('Aplicar')}
                    </Button>
                    <Button size="sm" variant="outline" onClick={onDiscard} disabled={busy} data-testid="agent-proposal-discard">
                        <X className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Descartar')}
                    </Button>
                </div>
            )}
        </div>
    );
}

/**
 * E6 — Las propuestas pendientes de un registro (modal, página y ficha
 * diseñada). Sin propuestas, no ocupa lugar.
 */
export function RecordAgentProposals({
    listId,
    recordId,
    readOnly = false,
    className,
}: {
    listId: number;
    recordId: number;
    readOnly?: boolean;
    className?: string;
}): JSX.Element | null {
    const query = useRecordAgentProposals(listId, recordId);
    const pending = query.data ?? [];
    if (pending.length === 0) return null;
    return (
        <section
            className={cn('imcrm-rounded-lg imcrm-border imcrm-border-info/30 imcrm-bg-info/5 imcrm-p-3', className)}
            data-testid="record-agent-proposals"
        >
            <h3 className="imcrm-mb-2 imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                <Bot className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                {pending.length === 1 ? __('Propuesta de un agente de IA') : sprintf(__('%d propuestas de agentes de IA'), pending.length)}
            </h3>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-divide-y imcrm-divide-border">
                {pending.map((p) => (
                    <div key={p.id} className="imcrm-pt-3 first:imcrm-pt-0">
                        <AgentProposalCard proposal={p} readOnly={readOnly} />
                    </div>
                ))}
            </div>
        </section>
    );
}

/** E6 — «Mi trabajo» → Agentes: las propuestas que esperan mi revisión. */
export function MyAgentProposalsTab({ query }: { query: UseQueryResult<MyAgentProposalsDto> }): JSX.Element {
    if (query.isLoading) {
        return (
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando…')}
            </p>
        );
    }
    if (query.isError || !query.data) return <p className="imcrm-text-sm imcrm-text-destructive">{__('No se pudieron cargar las propuestas.')}</p>;
    const { pending } = query.data;
    if (pending.length === 0) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-6 imcrm-py-12 imcrm-text-center">
                <Bot className="imcrm-h-7 imcrm-w-7 imcrm-text-muted-foreground" />
                <p className="imcrm-text-sm imcrm-font-medium">{__('Nada por revisar')}</p>
                <p className="imcrm-max-w-md imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Cuando un agente de IA que revisas proponga cambios en un registro, aparecen aquí para que los apliques o los descartes.')}
                </p>
            </div>
        );
    }
    return (
        <Card data-testid="my-agent-proposals">
            <ul className="imcrm-divide-y imcrm-divide-border">
                {pending.map((p) => (
                    <li key={p.id}>
                        <AgentProposalCard proposal={p} compact showRecord />
                    </li>
                ))}
            </ul>
        </Card>
    );
}
