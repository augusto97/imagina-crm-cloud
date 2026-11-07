import { useState } from 'react';
import { CalendarCheck2, CalendarX2, Clock3, CreditCard, Loader2 } from 'lucide-react';
import type { PublicAppointmentPayment } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useDecideBooking, useRecordBooking } from '@/hooks/useRecordBooking';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

interface RecordBookingPanelProps {
    listId: number;
    recordId: number;
    className?: string;
}

/** v0.1.387 — Cómo va el cobro de la cita, en una línea. */
function paymentLine(pay: PublicAppointmentPayment, marked?: { by: string | null; at: string | null }): string {
    const what = pay.kind === 'deposit' ? __('Anticipo') : __('Pago');
    if (pay.manual) {
        return marked?.by && marked.at
            ? sprintf(__('%1$s de %2$s marcado como recibido por %3$s el %4$s.'), what, pay.amount_label, marked.by, formatDateTimeStr(marked.at))
            : sprintf(__('%1$s de %2$s marcado como recibido por el equipo.'), what, pay.amount_label);
    }
    switch (pay.status) {
        case 'paid':
            return sprintf(__('%1$s de %2$s recibido.'), what, pay.amount_label);
        case 'refunded':
            return sprintf(__('%1$s de %2$s reembolsado.'), what, pay.amount_label);
        case 'expired':
            return sprintf(__('%1$s de %2$s sin pagar: el link venció.'), what, pay.amount_label);
        case 'failed':
            return sprintf(__('%1$s de %2$s rechazado: el cliente puede volver a intentarlo.'), what, pay.amount_label);
        default:
            return sprintf(__('%1$s de %2$s pendiente.'), what, pay.amount_label);
    }
}

function PaymentNote({ pay, marked, className }: { pay: PublicAppointmentPayment; marked?: { by: string | null; at: string | null }; className?: string }): JSX.Element {
    return (
        <p className={cn('imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground', className)} data-testid="record-booking-payment" data-payment-status={pay.status}>
            <CreditCard className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
            <span>
                {paymentLine(pay, marked)}
                {pay.url && pay.status !== 'paid' && (
                    <>
                        {' '}
                        <a href={pay.url} target="_blank" rel="noreferrer noopener" className="imcrm-underline">
                            {__('Ver el link de pago')}
                        </a>
                    </>
                )}
            </span>
        </p>
    );
}

function errorText(err: unknown): string {
    const e = err as { message?: string; response?: { message?: string }; data?: { message?: string } };
    return e?.data?.message ?? e?.response?.message ?? e?.message ?? __('No se pudo guardar. Prueba de nuevo.');
}

/**
 * v0.1.353 — La cita de un registro de la agenda: si está «Por confirmar»,
 * el aviso con Aprobar / Rechazar (con motivo opcional, que le llega al
 * cliente) y hasta cuándo hay para decidir. Si ya se decidió, una línea con
 * quién y cuándo. Un registro que no es una cita no muestra nada.
 */
export function RecordBookingPanel({ listId, recordId, className }: RecordBookingPanelProps): JSX.Element | null {
    const query = useRecordBooking(listId, recordId);
    const decide = useDecideBooking(listId, recordId);
    const toast = useToast();
    const [declining, setDeclining] = useState(false);
    const [reason, setReason] = useState('');
    const b = query.data;
    if (!b) return null;

    const when = formatDateTimeStr(b.start);
    if (b.status === 'unpaid') return <UnpaidPanel listId={listId} recordId={recordId} className={className} />;
    if (b.status === 'declined' || (b.status === 'confirmed' && b.decided_at)) {
        const declined = b.status === 'declined';
        const line = (
            <p className={cn('imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground', !b.payment && className)} data-testid="record-booking-decided">
                {declined ? <CalendarX2 className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" /> : <CalendarCheck2 className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />}
                <span>
                    {declined
                        ? b.decided_by_name
                            ? sprintf(__('Cita rechazada por %1$s el %2$s.'), b.decided_by_name, formatDateTimeStr(b.decided_at ?? b.start))
                            : sprintf(__('Cita rechazada sola: nadie la decidió a tiempo (%s).'), formatDateTimeStr(b.decided_at ?? b.start))
                        : b.decided_by_name
                          ? sprintf(__('Cita aprobada por %1$s el %2$s.'), b.decided_by_name, formatDateTimeStr(b.decided_at!))
                          : sprintf(__('Cita confirmada sola al vencer el plazo (%s).'), formatDateTimeStr(b.decided_at!))}
                    {declined && b.decline_reason ? ` ${sprintf(__('Motivo: %s'), b.decline_reason)}` : ''}
                </span>
            </p>
        );
        // v0.1.387 — si la cita cobra al agendar, cómo quedó el pago debajo.
        if (!b.payment) return line;
        return (
            <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-1', className)}>
                {line}
                <PaymentNote pay={b.payment} marked={{ by: b.paid_marked_by_name ?? null, at: b.paid_marked_at ?? null }} />
            </div>
        );
    }
    if (b.status !== 'pending') return b.payment ? <PaymentNote pay={b.payment} marked={{ by: b.paid_marked_by_name ?? null, at: b.paid_marked_at ?? null }} className={className} /> : null;

    const run = (decision: 'approve' | 'decline'): void => {
        decide.mutate(
            { decision, ...(decision === 'decline' && reason.trim() ? { reason: reason.trim() } : {}) },
            {
                onSuccess: () => {
                    toast.success(decision === 'approve' ? __('Cita aprobada: le avisamos al cliente') : __('Cita rechazada: le avisamos al cliente'));
                    setDeclining(false);
                    setReason('');
                },
                onError: (err) => toast.error(__('No se pudo guardar'), errorText(err)),
            },
        );
    };

    return (
        <section
            className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-violet-500/30 imcrm-bg-violet-500/5 imcrm-p-3', className)}
            data-testid="record-booking-pending"
            data-tour="record-booking-approval"
        >
            <div className="imcrm-flex imcrm-items-start imcrm-gap-2">
                <Clock3 className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-violet-600 dark:imcrm-text-violet-400" />
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5">
                    <span className="imcrm-text-sm imcrm-font-semibold">{__('Cita por confirmar')}</span>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                        {[b.service, b.staff ? sprintf(__('con %s'), b.staff) : '', when].filter(Boolean).join(' · ')}
                    </span>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                        {[b.client_name, b.client_email].filter(Boolean).join(' · ')}
                    </span>
                    {b.payment && <PaymentNote pay={b.payment} />}
                    {b.pending_until && (
                        <span className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="record-booking-deadline">
                            {b.on_timeout === 'approve'
                                ? sprintf(__('Si nadie decide antes del %s, se confirma sola.'), formatDateTimeStr(b.pending_until))
                                : sprintf(__('Si nadie decide antes del %s, se rechaza sola.'), formatDateTimeStr(b.pending_until))}
                        </span>
                    )}
                </div>
            </div>
            {b.can_decide ? (
                declining ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label htmlFor={`booking-decline-${recordId}`} className="imcrm-text-xs">
                            {__('Motivo (opcional, le llega al cliente)')}
                        </Label>
                        <Textarea id={`booking-decline-${recordId}`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="record-booking-reason" />
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                            <Button size="sm" variant="destructive" disabled={decide.isPending} onClick={() => run('decline')} data-testid="record-booking-decline-confirm">
                                {decide.isPending && <Loader2 className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                                {__('Rechazar la cita')}
                            </Button>
                            <Button size="sm" variant="ghost" disabled={decide.isPending} onClick={() => setDeclining(false)}>
                                {__('Volver')}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        <Button size="sm" disabled={decide.isPending} onClick={() => run('approve')} data-testid="record-booking-approve">
                            {decide.isPending && <Loader2 className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                            {__('Aprobar')}
                        </Button>
                        <Button size="sm" variant="outline" disabled={decide.isPending} onClick={() => setDeclining(true)} data-testid="record-booking-decline">
                            {__('Rechazar')}
                        </Button>
                    </div>
                )
            ) : (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('La aprueba quien administra la lista o quien aprueba las citas de esta agenda.')}</p>
            )}
        </section>
    );
}

/**
 * v0.1.387 — Esperando el pago: el horario está apartado hasta que el cliente
 * pague (o vence y se libera). Si pagó por otro medio (transferencia, en el
 * local), quien aprueba las citas la confirma a mano.
 */
function UnpaidPanel({ listId, recordId, className }: RecordBookingPanelProps): JSX.Element | null {
    const query = useRecordBooking(listId, recordId);
    const decide = useDecideBooking(listId, recordId);
    const toast = useToast();
    const b = query.data;
    if (!b) return null;
    const markPaid = (): void => {
        decide.mutate(
            { decision: 'mark_paid' },
            {
                onSuccess: () => toast.success(__('Cita confirmada: le avisamos al cliente')),
                onError: (err) => toast.error(__('No se pudo guardar'), errorText(err)),
            },
        );
    };
    return (
        <section
            className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-amber-500/30 imcrm-bg-amber-500/5 imcrm-p-3', className)}
            data-testid="record-booking-unpaid"
            data-tour="record-booking-payment"
        >
            <div className="imcrm-flex imcrm-items-start imcrm-gap-2">
                <CreditCard className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-amber-600 dark:imcrm-text-amber-400" />
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5">
                    <span className="imcrm-text-sm imcrm-font-semibold">{__('Esperando el pago')}</span>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">
                        {[b.service, b.staff ? sprintf(__('con %s'), b.staff) : '', formatDateTimeStr(b.start)].filter(Boolean).join(' · ')}
                    </span>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{[b.client_name, b.client_email].filter(Boolean).join(' · ')}</span>
                    {b.payment && <PaymentNote pay={b.payment} />}
                    {b.payment_until && (
                        <span className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="record-booking-payment-until">
                            {sprintf(__('El horario queda apartado hasta el %s. Si no paga, se libera solo.'), formatDateTimeStr(b.payment_until))}
                        </span>
                    )}
                </div>
            </div>
            {b.can_mark_paid ? (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                        <Button size="sm" variant="outline" disabled={decide.isPending} onClick={markPaid} data-testid="record-booking-mark-paid">
                            {decide.isPending && <Loader2 className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />}
                            {__('Marcar como pagada')}
                        </Button>
                    </div>
                    <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Si pagó por otro medio (transferencia, en el local): la cita se confirma y el link de pago deja de servir.')}</p>
                </div>
            ) : (
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('Se confirma sola cuando llegue el pago.')}</p>
            )}
        </section>
    );
}
