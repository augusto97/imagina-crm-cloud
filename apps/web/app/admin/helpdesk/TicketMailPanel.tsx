import { useMemo, useState } from 'react';
import { Inbox, Loader2, Mail, Reply, Send, X } from 'lucide-react';
import { readHelpdeskMailboxMarker, readHelpdeskSettings, replySubject, type HelpdeskSlaDto } from '@imagina-base/shared';

import { extractFieldOptions } from '@/admin/records/fieldOptions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { useFields } from '@/hooks/useFields';
import { useHelpdeskTicket, useRenderReplyTemplate, useReplyByEmail } from '@/hooks/useHelpdesk';
import { useList } from '@/hooks/useLists';
import { ApiError } from '@/lib/api';
import { useIsGuest } from '@/lib/guest';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTime } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';
import { cn } from '@/lib/utils';

import { dueIn, SLA_STATUS_VARIANT, slaStatusLabel } from './helpdeskUi';
import { usePlanModuleOff } from '@/components/PlanModuleNotice';

/**
 * D2/E5 — En la ficha de un ticket (modal, página y ficha diseñada): de quién
 * es, cómo va su SLA y «Responder por correo». La respuesta sale por el
 * correo de la empresa desde la dirección de soporte, con las cabeceras del
 * hilo (el cliente la ve en la misma conversación) y queda como un
 * comentario visible para él. Una nota INTERNA se sigue escribiendo en los
 * comentarios: nunca sale por correo.
 */
function TicketMailPanelInner({ listId, recordId, compact = false }: { listId: number; recordId: number; compact?: boolean }): JSX.Element | null {
    const list = useList(listId);
    const isGuest = useIsGuest();
    const marker = readHelpdeskMailboxMarker(list.data?.settings);
    const settings = readHelpdeskSettings(list.data?.settings);
    const enabled = !isGuest && (marker !== null || settings.sla.enabled);
    const ticket = useHelpdeskTicket(listId, recordId, enabled);
    const [open, setOpen] = useState(false);

    if (!enabled || !ticket.data) return null;
    const t = ticket.data;
    const hasThread = t.customer_email !== null || t.messages.length > 0;
    if (!hasThread && !t.sla) return null;

    return (
        <section
            className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3"
            data-testid="imcrm-ticket-mail"
            aria-label={__('Ticket por correo')}
        >
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <Inbox className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                    <span className="imcrm-shrink-0 imcrm-font-mono imcrm-text-xs imcrm-text-muted-foreground">{t.token}</span>
                    {t.customer_email ? (
                        <span className="imcrm-min-w-0 imcrm-truncate">
                            <span className="imcrm-font-medium">{t.customer_name || t.customer_email}</span>
                            {t.customer_name && <span className="imcrm-text-muted-foreground"> · {t.customer_email}</span>}
                        </span>
                    ) : (
                        <span className="imcrm-text-muted-foreground">{__('Sin cliente por correo')}</span>
                    )}
                </div>
                {t.can_reply && t.support_address && !open && (
                    <Button size="sm" onClick={() => setOpen(true)} className="imcrm-h-8 imcrm-gap-1.5" data-testid="imcrm-ticket-reply-open">
                        <Reply className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Responder por correo')}
                    </Button>
                )}
            </div>
            {t.sla && <SlaChips sla={t.sla} compact={compact} />}
            {open && t.support_address && (
                <ReplyComposer
                    listId={listId}
                    recordId={recordId}
                    supportAddress={t.support_address}
                    defaultTo={t.customer_email ?? ''}
                    defaultSubject={replySubject(t.subject, t.token)}
                    templates={t.templates}
                    includeSignature={t.include_signature}
                    statusFieldId={settings.status_field_id}
                    onClose={() => setOpen(false)}
                />
            )}
        </section>
    );
}

/** El SLA del ticket: estado y cuánto falta para cada objetivo. */
export function SlaChips({ sla, compact = false }: { sla: HelpdeskSlaDto; compact?: boolean }): JSX.Element {
    const item = (label: string, due: string | null, doneAt: string | null): JSX.Element | null => {
        if (!due && !doneAt) return null;
        const late = !doneAt && due !== null && new Date(due).getTime() < Date.now();
        return (
            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground" title={due ? formatDateTime(parseUtcDate(due)) : undefined}>
                <span className="imcrm-font-medium imcrm-text-foreground">{label}:</span>
                {doneAt ? (
                    <span>{sprintf(__('cumplida el %s'), formatDateTime(parseUtcDate(doneAt)))}</span>
                ) : (
                    <span className={cn(late && 'imcrm-font-medium imcrm-text-[hsl(var(--imcrm-destructive-ink))]')}>
                        {late ? sprintf(__('venció %s'), dueIn(due)) : sprintf(__('vence %s'), dueIn(due))}
                    </span>
                )}
            </span>
        );
    };
    return (
        <div className={cn('imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1', compact && 'imcrm-text-xs')} data-testid="imcrm-ticket-sla">
            <Badge variant={sla.status ? SLA_STATUS_VARIANT[sla.status] : 'secondary'}>{sprintf(__('SLA: %s'), slaStatusLabel(sla.status))}</Badge>
            {sla.paused && <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Reloj detenido: esperando al cliente')}</span>}
            {item(__('Primera respuesta'), sla.first_response_due, sla.first_response_at)}
            {item(__('Resolución'), sla.resolution_due, sla.resolved_at)}
        </div>
    );
}

function ReplyComposer({
    listId,
    recordId,
    supportAddress,
    defaultTo,
    defaultSubject,
    templates,
    includeSignature,
    statusFieldId,
    onClose,
}: {
    listId: number;
    recordId: number;
    supportAddress: string;
    defaultTo: string;
    defaultSubject: string;
    templates: Array<{ id: string; name: string }>;
    includeSignature: boolean;
    statusFieldId: number | null;
    onClose: () => void;
}): JSX.Element {
    const reply = useReplyByEmail(listId, recordId);
    const render = useRenderReplyTemplate(listId, recordId);
    const fieldsData = useFields(listId).data;
    const fields = useMemo(() => fieldsData ?? [], [fieldsData]);
    const toast = useToast();
    const [to, setTo] = useState(defaultTo);
    const [cc, setCc] = useState('');
    const [showCc, setShowCc] = useState(false);
    const [subject, setSubject] = useState(defaultSubject);
    const [body, setBody] = useState('');
    const [signature, setSignature] = useState(includeSignature);
    const [status, setStatus] = useState('');
    const [error, setError] = useState<string | null>(null);
    const statusOptions = useMemo(() => {
        const f = fields.find((x) => x.id === statusFieldId);
        return f ? extractFieldOptions(f) : [];
    }, [fields, statusFieldId]);

    const insertTemplate = (id: string): void => {
        if (!id) return;
        render.mutate(id, {
            onSuccess: (text) => setBody((b) => (b.trim() === '' ? text : `${b.replace(/\s+$/, '')}\n\n${text}`)),
            onError: (err) => setError(err instanceof Error ? err.message : __('No se pudo usar la respuesta guardada.')),
        });
    };

    const send = (): void => {
        setError(null);
        reply.mutate(
            {
                body,
                ...(to.trim() !== defaultTo ? { to: to.trim() } : {}),
                ...(cc.trim() !== '' ? { cc: cc.trim() } : {}),
                ...(subject.trim() !== defaultSubject ? { subject: subject.trim() } : {}),
                signature,
                ...(status !== '' ? { set_status: status } : {}),
            },
            {
                onSuccess: (res) => {
                    if (res.warning) toast.warning(__('El correo salió'), res.warning);
                    else toast.success(__('Respuesta enviada'), sprintf(__('A %s'), res.to));
                    onClose();
                },
                onError: (err) => setError(err instanceof ApiError ? (Object.values(err.errors)[0] ?? err.message) : err instanceof Error ? err.message : __('No se pudo enviar.')),
            },
        );
    };

    return (
        <form
            className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-2"
            data-testid="imcrm-ticket-composer"
            onSubmit={(e) => {
                e.preventDefault();
                send();
            }}
        >
            <div className="imcrm-grid imcrm-grid-cols-[3.5rem_1fr] imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1.5 imcrm-text-sm">
                <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('De')}</span>
                <span className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{supportAddress}</span>
                <label htmlFor="hd-reply-to" className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Para')}
                </label>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Input id="hd-reply-to" className="imcrm-h-8" value={to} onChange={(e) => setTo(e.target.value)} placeholder="cliente@ejemplo.com" />
                    {!showCc && (
                        <button type="button" className="imcrm-shrink-0 imcrm-text-xs imcrm-text-primary hover:imcrm-underline" onClick={() => setShowCc(true)}>
                            {__('Cc')}
                        </button>
                    )}
                </div>
                {showCc && (
                    <>
                        <label htmlFor="hd-reply-cc" className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Cc')}
                        </label>
                        <Input id="hd-reply-cc" className="imcrm-h-8" value={cc} onChange={(e) => setCc(e.target.value)} />
                    </>
                )}
                <label htmlFor="hd-reply-subject" className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Asunto')}
                </label>
                <Input id="hd-reply-subject" className="imcrm-h-8" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            {templates.length > 0 && (
                <Select aria-label={__('Insertar una respuesta guardada')} className="imcrm-h-8 imcrm-text-xs" value="" onChange={(e) => insertTemplate(e.target.value)} data-testid="imcrm-ticket-template">
                    <option value="">{render.isPending ? __('Preparando…') : __('Insertar una respuesta guardada…')}</option>
                    {templates.map((tp) => (
                        <option key={tp.id} value={tp.id}>
                            {tp.name}
                        </option>
                    ))}
                </Select>
            )}
            <Textarea
                aria-label={__('Respuesta')}
                rows={6}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder={__('Escribe la respuesta al cliente…')}
                autoFocus
                onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && body.trim() !== '') send();
                }}
            />
            {/* Se acomoda al ANCHO del panel (en el modal es una columna de 380 px): las opciones arriba y los botones bajan si no entran. */}
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-end imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1.5 imcrm-text-xs">
                    <label className="imcrm-flex imcrm-cursor-pointer imcrm-items-center imcrm-gap-1.5 imcrm-text-muted-foreground">
                        <input type="checkbox" className="imcrm-h-3.5 imcrm-w-3.5" checked={signature} onChange={(e) => setSignature(e.target.checked)} />
                        {__('Agregar mi firma')}
                    </label>
                    {statusOptions.length > 0 && (
                        <label className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-text-muted-foreground">
                            <span className="imcrm-whitespace-nowrap">{__('Después, poner el estado en')}</span>
                            <Select className="imcrm-h-7 imcrm-w-auto imcrm-text-xs" value={status} onChange={(e) => setStatus(e.target.value)} data-testid="imcrm-ticket-set-status">
                                <option value="">{__('(no cambiar)')}</option>
                                {statusOptions.map((o) => (
                                    <option key={o.value} value={o.value}>
                                        {o.label}
                                    </option>
                                ))}
                            </Select>
                        </label>
                    )}
                </div>
                <div className="imcrm-ml-auto imcrm-flex imcrm-shrink-0 imcrm-justify-end imcrm-gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                        <X className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Cancelar')}
                    </Button>
                    <Button type="submit" size="sm" disabled={body.trim() === '' || reply.isPending} data-testid="imcrm-ticket-send">
                        {reply.isPending ? <Loader2 className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Send className="imcrm-mr-1 imcrm-h-3.5 imcrm-w-3.5" />}
                        {reply.isPending ? __('Enviando…') : __('Enviar')}
                    </Button>
                </div>
            </div>
            <p className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                <Mail className="imcrm-h-3 imcrm-w-3" aria-hidden />
                {__('El cliente la recibe en la misma conversación. Para una nota interna usa los comentarios: nunca salen por correo.')}
            </p>
            {error && (
                <p className="imcrm-text-sm imcrm-text-destructive" role="alert">
                    {error}
                </p>
            )}
        </form>
    );
}

/** v0.1.338 (ADR-S87) — sin el módulo en el plan, no aparece. */
export function TicketMailPanel(props: Parameters<typeof TicketMailPanelInner>[0]): JSX.Element | null {
    const off = usePlanModuleOff('helpdesk');
    return off ? null : <TicketMailPanelInner {...props} />;
}
