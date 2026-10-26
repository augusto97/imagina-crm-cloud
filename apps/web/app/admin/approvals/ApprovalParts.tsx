import { useEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, Circle, CircleDot, Clock, CornerUpLeft, Loader2, X, XCircle } from 'lucide-react';
import {
    APPROVAL_MODE_LABELS,
    APPROVAL_STATUS_COLORS,
    APPROVAL_STATUS_LABELS,
    type ApprovalDecisionKind,
    type ApprovalRequestDto,
    type ApprovalStatus,
    type ApprovalStepDto,
} from '@imagina-base/shared';

import { relativeTime } from '@/admin/activity/activityText';
import { Button } from '@/components/ui/button';
import { chipSoftStyle } from '@/components/ui/color-picker';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useCancelApproval, useDecideApproval } from '@/hooks/useApprovals';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTime } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';
import { cn } from '@/lib/utils';

import { approvalProgressLabel, confirmLabel, decisionNeedsReason, decisionVerb, missingApprovers } from './approvalUi';

/** El estado de una solicitud como chip con su color. */
export function ApprovalStatusChip({ status, className }: { status: ApprovalStatus; className?: string }): JSX.Element {
    return (
        <span
            className={cn(
                'imcrm-inline-flex imcrm-items-center imcrm-whitespace-nowrap imcrm-rounded-full imcrm-px-2 imcrm-py-0.5 imcrm-text-[11.5px] imcrm-font-medium',
                className,
            )}
            style={chipSoftStyle(APPROVAL_STATUS_COLORS[status]) ?? undefined}
            data-testid="imcrm-approval-status"
            data-status={status}
        >
            {APPROVAL_STATUS_LABELS[status]}
        </span>
    );
}

export function approvalErrorText(err: unknown): string {
    return err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo guardar la decisión.');
}

function when(iso: string): { rel: string; abs: string } {
    return { rel: relativeTime(iso), abs: formatDateTime(parseUtcDate(iso)) };
}

/**
 * Aprobar / Rechazar / Devolver el paso ACTUAL. Rechazar y devolver piden
 * motivo (se le muestra a quien pidió). La decisión lleva el paso que la
 * persona vio: si alguien lo resolvió entre medio, el servidor responde 409 y
 * se avisa sin aplicar nada sobre el paso siguiente.
 */
export function ApprovalDecisionBar({
    request,
    initialDecision = null,
    onDone,
    compact = false,
}: {
    /** Sólo hace falta el id y el paso que la persona está viendo. */
    request: Pick<ApprovalRequestDto, 'id' | 'current_step'>;
    /** La decisión que trae el enlace del correo (se pide confirmar igual). */
    initialDecision?: ApprovalDecisionKind | null;
    onDone?: () => void;
    compact?: boolean;
}): JSX.Element {
    const decide = useDecideApproval();
    const toast = useToast();
    const [picked, setPicked] = useState<ApprovalDecisionKind | null>(initialDecision);
    const [reason, setReason] = useState('');
    const reasonRef = useRef<HTMLTextAreaElement | null>(null);

    useEffect(() => {
        if (picked && decisionNeedsReason(picked)) reasonRef.current?.focus();
    }, [picked]);

    const submit = (decision: ApprovalDecisionKind): void => {
        if (decisionNeedsReason(decision) && reason.trim() === '') {
            toast.error(__('Escribe el motivo'), __('Se le muestra a quien pidió la aprobación.'));
            reasonRef.current?.focus();
            return;
        }
        decide.mutate(
            { id: request.id, decision, step: request.current_step, reason: reason.trim() },
            {
                onSuccess: (res) => {
                    toast.success(res.message);
                    for (const w of res.warnings) toast.warning(__('Atención'), w);
                    setPicked(null);
                    setReason('');
                    onDone?.();
                },
                onError: (err) => toast.error(__('No se pudo guardar la decisión'), approvalErrorText(err)),
            },
        );
    };

    const busy = decide.isPending;
    const needsReason = picked !== null && decisionNeedsReason(picked);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="imcrm-approval-decide">
            {needsReason && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <label htmlFor={`imcrm-approval-reason-${request.id}`} className="imcrm-text-xs imcrm-font-medium imcrm-text-foreground">
                        {picked === 'reject' ? __('Motivo del rechazo') : __('Qué hay que corregir')}
                    </label>
                    <Textarea
                        id={`imcrm-approval-reason-${request.id}`}
                        ref={reasonRef}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={compact ? 2 : 3}
                        maxLength={2000}
                        placeholder={picked === 'reject' ? __('Por ejemplo: falta la factura') : __('Por ejemplo: adjunta la cotización firmada')}
                        data-testid="imcrm-approval-reason"
                    />
                </div>
            )}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                {needsReason ? (
                    <>
                        <Button
                            size="sm"
                            variant={picked === 'reject' ? 'destructive' : 'default'}
                            disabled={busy}
                            onClick={() => submit(picked!)}
                            data-testid="imcrm-approval-confirm"
                        >
                            {busy && <Loader2 className="imcrm-mr-1.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                            {confirmLabel(picked!)}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setPicked(null); setReason(''); }}>
                            {__('Cancelar')}
                        </Button>
                    </>
                ) : (
                    <>
                        <Button size="sm" disabled={busy} onClick={() => submit('approve')} data-testid="imcrm-approval-approve">
                            {busy ? <Loader2 className="imcrm-mr-1.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Check className="imcrm-mr-1.5 imcrm-h-3.5 imcrm-w-3.5" />}
                            {__('Aprobar')}
                        </Button>
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => setPicked('reject')} data-testid="imcrm-approval-reject">
                            <X className="imcrm-mr-1.5 imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Rechazar')}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={busy} onClick={() => setPicked('return')} data-testid="imcrm-approval-return">
                            <CornerUpLeft className="imcrm-mr-1.5 imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Devolver')}
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}

function StepIcon({ state }: { state: ApprovalStepDto['state'] }): JSX.Element {
    switch (state) {
        case 'done':
            return <CheckCircle2 className="imcrm-h-4 imcrm-w-4 imcrm-text-emerald-600 dark:imcrm-text-emerald-400" aria-hidden />;
        case 'current':
            return <CircleDot className="imcrm-h-4 imcrm-w-4 imcrm-text-amber-600 dark:imcrm-text-amber-400" aria-hidden />;
        case 'stopped':
            return <XCircle className="imcrm-h-4 imcrm-w-4 imcrm-text-rose-600 dark:imcrm-text-rose-400" aria-hidden />;
        default:
            return <Circle className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground/60" aria-hidden />;
    }
}

const STATE_LABEL: Record<ApprovalStepDto['state'], string> = {
    done: __('Aprobado'),
    current: __('En curso'),
    upcoming: __('Pendiente'),
    stopped: __('Se detuvo aquí'),
};

/**
 * Una solicitud: los pasos en serie (quién aprueba cada uno, en qué modo,
 * quién ya aprobó en el actual), las decisiones con su motivo, quién la pidió
 * y la nota. `actions` = lo que va abajo (decidir, cancelar).
 */
export function ApprovalRequestCard({
    request,
    showFlowName = true,
    actions,
    className,
}: {
    request: ApprovalRequestDto;
    showFlowName?: boolean;
    actions?: React.ReactNode;
    className?: string;
}): JSX.Element {
    const requested = when(request.requested_at);
    const missing = missingApprovers(request);
    const requester = request.source === 'automation'
        ? sprintf(__('la automatización «%s»'), request.automation_name ?? __('sin nombre'))
        : request.requested_by?.name ?? __('Alguien');
    return (
        <div
            className={cn('imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3', className)}
            data-testid="imcrm-approval-request"
            data-request-id={request.id}
            data-status={request.status}
        >
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-min-w-0">
                    {showFlowName && <div className="imcrm-truncate imcrm-text-sm imcrm-font-semibold imcrm-text-foreground">{request.flow_name}</div>}
                    <div className="imcrm-text-xs imcrm-text-muted-foreground">
                        {sprintf(__('Pedida por %1$s · %2$s'), requester, requested.rel)}
                        <span className="imcrm-sr-only"> ({requested.abs})</span>
                    </div>
                </div>
                <ApprovalStatusChip status={request.status} />
            </div>

            {request.note.trim() !== '' && (
                <p className="imcrm-whitespace-pre-wrap imcrm-break-words imcrm-rounded-md imcrm-bg-muted/60 imcrm-px-2.5 imcrm-py-1.5 imcrm-text-[13px] imcrm-text-foreground">
                    {request.note}
                </p>
            )}

            <ol className="imcrm-flex imcrm-flex-col imcrm-gap-2" aria-label={__('Pasos de la aprobación')}>
                {request.steps.map((s, i) => {
                    const decisions = request.decisions.filter((d) => d.step === i);
                    return (
                        <li key={s.id} className="imcrm-flex imcrm-gap-2" data-testid="imcrm-approval-step" data-state={s.state}>
                            <span className="imcrm-mt-0.5 imcrm-shrink-0" title={STATE_LABEL[s.state]}>
                                <StepIcon state={s.state} />
                            </span>
                            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-baseline imcrm-gap-x-2 imcrm-text-[13px]">
                                    <span className="imcrm-font-medium imcrm-text-foreground">{s.name.trim() !== '' ? s.name : sprintf(__('Paso %d'), i + 1)}</span>
                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {s.approver_label} · {APPROVAL_MODE_LABELS[s.mode]}
                                    </span>
                                </div>
                                {s.state === 'current' && s.approvers.length > 0 && (
                                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                                        {s.approvers.map((a) => (
                                            <span
                                                key={a.id}
                                                className={cn(
                                                    'imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-border imcrm-px-2 imcrm-py-px imcrm-text-[11.5px]',
                                                    a.approved
                                                        ? 'imcrm-border-emerald-500/40 imcrm-bg-emerald-500/10 imcrm-text-emerald-800 dark:imcrm-text-emerald-300'
                                                        : 'imcrm-border-border imcrm-text-muted-foreground',
                                                )}
                                            >
                                                {a.approved ? <Check className="imcrm-h-3 imcrm-w-3" aria-hidden /> : <Clock className="imcrm-h-3 imcrm-w-3" aria-hidden />}
                                                {a.name}
                                            </span>
                                        ))}
                                    </div>
                                )}
                                {s.state === 'current' && s.approvers.length === 0 && (
                                    <span className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">
                                        {__('Nadie puede aprobar este paso ahora (revisa quién aprueba en el flujo o el campo de la persona).')}
                                    </span>
                                )}
                                {decisions.map((d) => {
                                    const t = when(d.created_at);
                                    return (
                                        <div key={d.id} className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-approval-decision">
                                            <span className="imcrm-font-medium imcrm-text-foreground">{d.user_name ?? __('Alguien')}</span>{' '}
                                            {decisionVerb(d.decision).toLowerCase()}
                                            {' · '}
                                            <span title={t.abs}>{t.rel}</span>
                                            {d.reason.trim() !== '' && (
                                                <span className="imcrm-block imcrm-whitespace-pre-wrap imcrm-break-words imcrm-text-foreground/80">«{d.reason}»</span>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </li>
                    );
                })}
            </ol>

            {request.status === 'pending' && missing.length > 0 && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {sprintf(__('Falta que aprueben: %s'), missing.join(', '))}
                </p>
            )}
            {request.status !== 'pending' && request.reason.trim() !== '' && (
                <p className="imcrm-whitespace-pre-wrap imcrm-break-words imcrm-text-xs imcrm-text-muted-foreground">
                    {request.status === 'cancelled' ? __('Motivo de la cancelación:') : __('Motivo:')} <span className="imcrm-text-foreground">{request.reason}</span>
                </p>
            )}
            {request.status !== 'pending' && request.resolved_at && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {request.resolved_by
                        ? sprintf(__('%1$s · %2$s'), approvalProgressLabel(request), request.resolved_by.name)
                        : approvalProgressLabel(request)}
                    {' · '}
                    <span title={when(request.resolved_at).abs}>{when(request.resolved_at).rel}</span>
                </p>
            )}
            {actions}
        </div>
    );
}

/** «Cancelar la solicitud» (quien la pidió o un admin), con motivo opcional. */
export function CancelApprovalButton({ request }: { request: ApprovalRequestDto }): JSX.Element {
    const cancel = useCancelApproval();
    const toast = useToast();
    const [open, setOpen] = useState(false);
    const [reason, setReason] = useState('');
    if (!open) {
        return (
            <button
                type="button"
                className="imcrm-self-start imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline"
                onClick={() => setOpen(true)}
                data-testid="imcrm-approval-cancel"
            >
                {__('Cancelar la solicitud')}
            </button>
        );
    }
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                maxLength={2000}
                placeholder={__('Motivo (opcional)')}
                aria-label={__('Motivo de la cancelación')}
            />
            <div className="imcrm-flex imcrm-gap-2">
                <Button
                    size="sm"
                    variant="outline"
                    disabled={cancel.isPending}
                    onClick={() =>
                        cancel.mutate(
                            { id: request.id, reason: reason.trim() },
                            {
                                onSuccess: (res) => {
                                    toast.success(res.message);
                                    setOpen(false);
                                },
                                onError: (err) => toast.error(__('No se pudo cancelar'), approvalErrorText(err)),
                            },
                        )
                    }
                    data-testid="imcrm-approval-cancel-confirm"
                >
                    {cancel.isPending && <Loader2 className="imcrm-mr-1.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                    {__('Cancelar la solicitud')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                    {__('Volver')}
                </Button>
            </div>
        </div>
    );
}
