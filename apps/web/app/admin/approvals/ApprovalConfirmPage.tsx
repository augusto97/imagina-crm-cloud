import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, ClipboardCheck, Loader2 } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { useApprovalRequest } from '@/hooks/useApprovals';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';

import { ApprovalDecisionBar, ApprovalRequestCard, ApprovalStatusChip } from './ApprovalParts';
import { approvalProgressLabel, confirmLabel, decisionFromQuery } from './approvalUi';

/**
 * C5 — La pantalla a la que llevan los botones Aprobar / Rechazar del correo.
 *
 * El enlace NO decide nada: trae el id de la solicitud y la decisión sugerida
 * (`?d=approve|reject`), y esta pantalla —con la SESIÓN de la persona (si no
 * hay, el login y después vuelve aquí)— muestra qué se está aprobando y pide
 * confirmar. La decisión es un POST que el servidor re-chequea (aprobador del
 * paso actual, en vivo, y que todavía pueda ver el registro). Un correo
 * reenviado no puede aprobar nada.
 */
export function ApprovalConfirmPage(): JSX.Element {
    const { approvalId } = useParams<{ approvalId: string }>();
    const [params] = useSearchParams();
    const id = Number(approvalId);
    const suggested = decisionFromQuery(params.get('d'));
    const query = useApprovalRequest(Number.isInteger(id) && id > 0 ? id : undefined);

    const back = (
        <Link to="/my-work?tab=approvals" className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground">
            <ArrowLeft className="imcrm-h-3.5 imcrm-w-3.5" />
            {__('Mis aprobaciones')}
        </Link>
    );

    if (query.isLoading) {
        return (
            <div className="imcrm-flex imcrm-h-64 imcrm-items-center imcrm-justify-center">
                <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
            </div>
        );
    }
    if (query.isError || !query.data) {
        const notFound = query.error instanceof ApiError && (query.error.status === 404 || query.error.status === 403);
        return (
            <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-xl imcrm-flex-col imcrm-gap-3 imcrm-py-6" data-testid="approval-confirm">
                {back}
                <Card>
                    <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-py-6">
                        <p className="imcrm-text-sm imcrm-font-medium">
                            {notFound ? __('No encontramos esta solicitud de aprobación') : __('No se pudo cargar la solicitud')}
                        </p>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {notFound
                                ? __('Puede que la hayan cancelado, que el registro ya no exista o que tu cuenta no tenga acceso a esa lista. Si el correo era para otra persona, ella tiene que abrirlo con su cuenta.')
                                : query.error instanceof Error
                                  ? query.error.message
                                  : ''}
                        </p>
                    </CardContent>
                </Card>
            </div>
        );
    }

    const { request, list, record_title } = query.data;
    const pending = request.status === 'pending';
    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-max-w-xl imcrm-flex-col imcrm-gap-3 imcrm-py-4" data-testid="approval-confirm">
            {back}
            <header className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <h1 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-lg imcrm-font-semibold">
                    <ClipboardCheck className="imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" aria-hidden />
                    {pending && request.can_decide ? __('Confirma tu decisión') : __('Solicitud de aprobación')}
                </h1>
                <p className="imcrm-text-sm imcrm-text-muted-foreground">
                    <Link to={`/lists/${list.slug}/records/${request.record_id}`} className="imcrm-font-medium imcrm-text-foreground hover:imcrm-underline" data-testid="approval-confirm-record">
                        {record_title}
                    </Link>
                    {' · '}
                    {list.name}
                </p>
            </header>

            {pending && request.can_decide && suggested && (
                <p className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/50 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground" data-testid="approval-confirm-suggested">
                    {sprintf(__('Elegiste «%s» desde el correo. Revisa la solicitud y confirma aquí: nada se decide hasta que tocas el botón.'), confirmLabel(suggested))}
                </p>
            )}
            {pending && !request.can_decide && (
                <p className="imcrm-rounded-md imcrm-border imcrm-border-amber-500/40 imcrm-bg-amber-500/[0.07] imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-amber-900 dark:imcrm-text-amber-200" data-testid="approval-confirm-not-yours">
                    {__('Ahora no te toca decidir esta solicitud: o ya diste tu aprobación en este paso, o la tiene que aprobar otra persona.')}{' '}
                    {approvalProgressLabel(request)}
                </p>
            )}
            {!pending && (
                <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm" data-testid="approval-confirm-resolved">
                    {__('Esta solicitud ya se resolvió:')} <ApprovalStatusChip status={request.status} />
                </p>
            )}

            <ApprovalRequestCard
                request={request}
                actions={
                    pending && request.can_decide ? (
                        <ApprovalDecisionBar key={`${request.id}:${request.current_step}`} request={request} initialDecision={suggested === 'approve' ? null : suggested} />
                    ) : null
                }
            />
        </div>
    );
}
