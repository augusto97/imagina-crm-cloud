import { useState } from 'react';
import { Link } from 'react-router';
import { ClipboardCheck, Loader2, Send } from 'lucide-react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { ApprovalInboxItem, MyApprovalsDto } from '@imagina-base/shared';

import { relativeTime } from '@/admin/activity/activityText';
import { IconSquare } from '@/admin/lists/FolderBadge';
import { Card } from '@/components/ui/card';
import { __, sprintf } from '@/lib/i18n';
import { DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { formatDateTime } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';

import { ApprovalDecisionBar, ApprovalStatusChip } from './ApprovalParts';

/**
 * C5 — «Mi trabajo» → Aprobaciones: lo que espera MI decisión (con Aprobar /
 * Rechazar / Devolver ahí mismo) y lo que pedí. El servidor ya resolvió quién
 * aprueba cada paso (en vivo) y el ACL de cada lista.
 */
export function MyApprovalsTab({ query }: { query: UseQueryResult<MyApprovalsDto> }): JSX.Element {
    if (query.isLoading) {
        return (
            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                {__('Cargando…')}
            </p>
        );
    }
    if (query.isError || !query.data) return <p className="imcrm-text-sm imcrm-text-destructive">{__('No se pudieron cargar las aprobaciones.')}</p>;
    const { pending, requested } = query.data;
    if (pending.length === 0 && requested.length === 0) {
        return (
            <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-6 imcrm-py-12 imcrm-text-center">
                <ClipboardCheck className="imcrm-h-7 imcrm-w-7 imcrm-text-muted-foreground" />
                <p className="imcrm-text-sm imcrm-font-medium">{__('Nada por aprobar')}</p>
                <p className="imcrm-max-w-md imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Cuando te toque aprobar un paso, aparece aquí y te llega un aviso. Lo que pidas tú también se sigue desde aquí.')}
                </p>
            </div>
        );
    }
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-5" data-testid="my-approvals">
            <section data-testid="my-approvals-pending">
                <h2 className="imcrm-mb-1.5 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                    {__('Esperan tu decisión')}
                    <span className="imcrm-font-normal">{pending.length}</span>
                </h2>
                {pending.length === 0 ? (
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('No tienes aprobaciones pendientes.')}</p>
                ) : (
                    <Card>
                        <ul className="imcrm-divide-y imcrm-divide-border">
                            {pending.map((i) => (
                                <PendingRow key={i.id} item={i} />
                            ))}
                        </ul>
                    </Card>
                )}
            </section>
            {requested.length > 0 && (
                <section data-testid="my-approvals-requested">
                    <h2 className="imcrm-mb-1.5 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        <Send className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Lo que pediste')}
                        <span className="imcrm-font-normal">{requested.length}</span>
                    </h2>
                    <Card>
                        <ul className="imcrm-divide-y imcrm-divide-border">
                            {requested.map((i) => (
                                <RequestedRow key={i.id} item={i} />
                            ))}
                        </ul>
                    </Card>
                </section>
            )}
        </div>
    );
}

function stepText(i: ApprovalInboxItem): string {
    if (i.steps_count <= 1 || i.status !== 'pending') return i.flow_name;
    const base = sprintf(__('Paso %1$d de %2$d'), i.current_step + 1, i.steps_count);
    return `${i.flow_name} · ${i.step_name.trim() !== '' ? `${base} · ${i.step_name}` : base}`;
}

function RecordLink({ item }: { item: ApprovalInboxItem }): JSX.Element {
    return (
        <>
            <IconSquare icon={listIcon(item.list_icon) ?? DEFAULT_LIST_ICON} color={listColor(item.list_color)} size="sm" />
            <div className="imcrm-min-w-0 imcrm-flex-1">
                <Link to={`/lists/${item.list_slug}/records/${item.record_id}`} className="imcrm-block imcrm-truncate imcrm-text-sm imcrm-font-medium hover:imcrm-underline">
                    {item.record_title}
                </Link>
                <p className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                    {item.list_name} · {stepText(item)}
                </p>
            </div>
        </>
    );
}

function PendingRow({ item }: { item: ApprovalInboxItem }): JSX.Element {
    const [decided, setDecided] = useState(false);
    return (
        <li className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-px-3 imcrm-py-3" data-approval-item={item.id}>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                <RecordLink item={item} />
                <span className="imcrm-shrink-0 imcrm-text-xs imcrm-text-muted-foreground" title={formatDateTime(parseUtcDate(item.requested_at))}>
                    {relativeTime(item.requested_at)}
                </span>
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {item.requested_by_name ? sprintf(__('Lo pidió %s'), item.requested_by_name) : __('Lo pidió una automatización')}
                {item.note.trim() !== '' && <span className="imcrm-text-foreground">{` · «${item.note}»`}</span>}
            </p>
            {!decided && <ApprovalDecisionBar request={{ id: item.id, current_step: item.current_step }} compact onDone={() => setDecided(true)} />}
        </li>
    );
}

function RequestedRow({ item }: { item: ApprovalInboxItem }): JSX.Element {
    return (
        <li className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-px-3 imcrm-py-2.5" data-approval-item={item.id}>
            <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                <RecordLink item={item} />
                <ApprovalStatusChip status={item.status} />
            </div>
            {item.reason.trim() !== '' && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Motivo:')} <span className="imcrm-text-foreground">{item.reason}</span>
                </p>
            )}
        </li>
    );
}
