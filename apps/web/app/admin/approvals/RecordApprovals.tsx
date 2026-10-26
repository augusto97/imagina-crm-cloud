import { useMemo, useState } from 'react';
import { BellRing, ClipboardCheck, Loader2, Send } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useRecordApprovals, useRequestApproval } from '@/hooks/useApprovals';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { ApprovalDecisionBar, ApprovalRequestCard, ApprovalStatusChip, CancelApprovalButton, approvalErrorText } from './ApprovalParts';
import { approvalProgressLabel, sortRequests } from './approvalUi';

interface RecordApprovalsProps {
    listId: number;
    recordId: number;
    /** Sin pedir ni decidir (vista previa del editor de la ficha). */
    readOnly?: boolean;
    /** Sin el encabezado (el bloque de la ficha diseñada ya pone su título). */
    hideHeading?: boolean;
    className?: string;
}

/**
 * C5 — La sección «Aprobación» de la ficha (modal, página y bloque de la
 * ficha diseñada).
 *
 * - Si la persona aprueba el paso actual de una solicitud pendiente: el aviso
 *   destacado «Pendiente de tu aprobación» con Aprobar / Rechazar / Devolver.
 * - Las solicitudes del registro (la abierta primero) con sus pasos, quién
 *   aprobó, cuándo y los motivos.
 * - «Pedir aprobación» (quien puede editar el registro): flujo + nota.
 *
 * Lo que se puede o no se puede lo decide el servidor (`can_request`,
 * `can_decide`, `can_cancel`, `blocked_reason`): aquí sólo se muestra.
 */
export function RecordApprovals({ listId, recordId, readOnly = false, hideHeading = false, className }: RecordApprovalsProps): JSX.Element | null {
    const query = useRecordApprovals(listId, recordId);
    const request = useRequestApproval(listId, recordId);
    const toast = useToast();
    const [asking, setAsking] = useState(false);
    const [flowId, setFlowId] = useState<number | null>(null);
    const [note, setNote] = useState('');
    const [showHistory, setShowHistory] = useState(false);

    const data = query.data;
    const requests = useMemo(() => sortRequests(data?.requests ?? []), [data?.requests]);
    const flows = data?.flows ?? [];
    const requestable = flows.filter((f) => f.can_request);

    if (query.isLoading) {
        return (
            <section className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2', className)}>
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-muted-foreground" />
            </section>
        );
    }
    if (!data) return null;
    // Una lista sin flujos ni solicitudes: la sección no aparece.
    if (flows.length === 0 && requests.length === 0) {
        if (!readOnly) return null;
        return (
            <section className={cn('imcrm-text-xs imcrm-text-muted-foreground', className)} data-testid="imcrm-record-approvals">
                {__('Esta lista todavía no tiene flujos de aprobación (Ajustes de la lista → Aprobaciones).')}
            </section>
        );
    }

    const mine = requests.filter((r) => r.status === 'pending' && r.can_decide);
    const open = requests.filter((r) => r.status === 'pending' && !r.can_decide);
    const latest = requests[0] ?? null;
    const shown = requests.filter((r) => !mine.includes(r) && !open.includes(r));
    const visibleHistory = showHistory ? shown : shown.slice(0, 1);
    const selectedFlow = flowId ?? requestable[0]?.id ?? null;
    // Sin un flujo que se pueda pedir ahora (p. ej. ya hay una pendiente), no se ofrece.
    const canAsk = !readOnly && data.can_request && requestable.length > 0;

    const submit = (): void => {
        if (selectedFlow === null) return;
        request.mutate(
            { flow_id: selectedFlow, note: note.trim() },
            {
                onSuccess: () => {
                    toast.success(__('Se pidió la aprobación'), __('Les avisamos a quienes aprueban el primer paso.'));
                    setAsking(false);
                    setNote('');
                    setFlowId(null);
                },
                onError: (err) => toast.error(__('No se pudo pedir la aprobación'), approvalErrorText(err)),
            },
        );
    };

    return (
        <section className={cn('imcrm-flex imcrm-flex-col imcrm-gap-3', className)} data-testid="imcrm-record-approvals">
            {!hideHeading && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                    <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        <ClipboardCheck className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Aprobación')}
                        {latest && <ApprovalStatusChip status={latest.status} className="imcrm-ml-1 imcrm-normal-case imcrm-tracking-normal" />}
                    </h3>
                    {canAsk && !asking && (
                        <Button size="sm" variant="outline" onClick={() => setAsking(true)} data-testid="imcrm-approval-ask">
                            <Send className="imcrm-mr-1.5 imcrm-h-3.5 imcrm-w-3.5" />
                            {__('Pedir aprobación')}
                        </Button>
                    )}
                </div>
            )}
            {hideHeading && canAsk && !asking && (
                <Button size="sm" variant="outline" className="imcrm-self-start" onClick={() => setAsking(true)} data-testid="imcrm-approval-ask">
                    <Send className="imcrm-mr-1.5 imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Pedir aprobación')}
                </Button>
            )}

            {asking && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-3" data-testid="imcrm-approval-ask-form">
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <Label htmlFor={`imcrm-approval-flow-${recordId}`}>{__('Flujo de aprobación')}</Label>
                        <Select
                            id={`imcrm-approval-flow-${recordId}`}
                            value={selectedFlow === null ? '' : String(selectedFlow)}
                            onChange={(e) => setFlowId(e.target.value === '' ? null : Number(e.target.value))}
                            data-testid="imcrm-approval-flow-select"
                        >
                            {flows.map((f) => (
                                <option key={f.id} value={f.id} disabled={!f.can_request}>
                                    {f.can_request ? f.name : `${f.name} — ${f.blocked_reason ?? __('no disponible')}`}
                                </option>
                            ))}
                        </Select>
                        {(() => {
                            const f = flows.find((x) => x.id === selectedFlow);
                            if (!f) return null;
                            return (
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {f.description.trim() !== '' ? `${f.description} · ` : ''}
                                    {f.steps === 1 ? __('1 paso') : sprintf(__('%d pasos'), f.steps)}
                                </span>
                            );
                        })()}
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        <Label htmlFor={`imcrm-approval-note-${recordId}`}>{__('Nota para quienes aprueban (opcional)')}</Label>
                        <Textarea
                            id={`imcrm-approval-note-${recordId}`}
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            rows={2}
                            maxLength={2000}
                            placeholder={__('Por ejemplo: es el gasto del viaje a Medellín')}
                            data-testid="imcrm-approval-note"
                        />
                    </div>
                    {requestable.length === 0 && (
                        <p className="imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400">
                            {__('Ahora no se puede pedir ninguno de los flujos: mira el motivo junto a cada uno.')}
                        </p>
                    )}
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        <Button
                            size="sm"
                            onClick={submit}
                            disabled={request.isPending || selectedFlow === null || !requestable.some((f) => f.id === selectedFlow)}
                            data-testid="imcrm-approval-send"
                        >
                            {request.isPending && <Loader2 className="imcrm-mr-1.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                            {__('Pedir aprobación')}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setAsking(false)} disabled={request.isPending}>
                            {__('Cancelar')}
                        </Button>
                    </div>
                </div>
            )}

            {mine.map((r) => (
                <div
                    key={r.id}
                    className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-amber-500/50 imcrm-bg-amber-500/[0.07] imcrm-p-3"
                    data-testid="imcrm-approval-mine"
                >
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-semibold imcrm-text-amber-900 dark:imcrm-text-amber-200">
                        <BellRing className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        {__('Pendiente de tu aprobación')}
                    </div>
                    <div className="imcrm-text-xs imcrm-text-muted-foreground">
                        {r.flow_name} · {approvalProgressLabel(r)}
                    </div>
                    <ApprovalRequestCard
                        request={r}
                        showFlowName={false}
                        className="imcrm-bg-background"
                        actions={readOnly ? null : (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                                <ApprovalDecisionBar request={r} />
                                {r.can_cancel && <CancelApprovalButton request={r} />}
                            </div>
                        )}
                    />
                </div>
            ))}

            {open.map((r) => (
                <ApprovalRequestCard
                    key={r.id}
                    request={r}
                    actions={!readOnly && r.can_cancel ? <CancelApprovalButton request={r} /> : null}
                />
            ))}

            {visibleHistory.map((r) => (
                <ApprovalRequestCard key={r.id} request={r} />
            ))}
            {shown.length > 1 && (
                <button
                    type="button"
                    onClick={() => setShowHistory((v) => !v)}
                    className="imcrm-self-start imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline"
                    data-testid="imcrm-approval-history-toggle"
                >
                    {showHistory ? __('Ver menos') : sprintf(__('Ver solicitudes anteriores (%d)'), shown.length - 1)}
                </button>
            )}
            {requests.length === 0 && !asking && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Todavía no se pidió ninguna aprobación para este registro.')}</p>
            )}
        </section>
    );
}
