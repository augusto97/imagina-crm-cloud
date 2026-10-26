import { Inbox, Paperclip, Send } from 'lucide-react';

import { useAttachments } from '@/hooks/useAttachments';
import { __ } from '@/lib/i18n';
import type { CommentEntity } from '@/types/comment';

/** D2 — Lo que la mesa de ayuda guarda de un correo en el comentario (`metadata.email`). */
export interface CommentEmailMeta {
    direction: 'in' | 'out';
    from?: string;
    from_name?: string;
    to?: string;
    cc?: string;
    subject?: string;
    automation?: string;
    attachments?: Array<{ id: number; name: string; size?: number }>;
}

/** El correo del comentario, si lo es (entrante del cliente o respuesta enviada). */
export function emailOf(comment: Pick<CommentEntity, 'metadata'>): CommentEmailMeta | null {
    const raw = (comment.metadata as { email?: unknown } | undefined)?.email;
    if (!raw || typeof raw !== 'object') return null;
    const e = raw as Partial<CommentEmailMeta>;
    return e.direction === 'in' || e.direction === 'out' ? (e as CommentEmailMeta) : null;
}

/**
 * D2 — La cabecera de un comentario que es un CORREO: «Correo del cliente»
 * o «Respuesta por correo», el asunto, a quién fue y los adjuntos (enlazados
 * por el módulo de archivos). No se edita: es lo que se mandó/recibió.
 */
export function EmailCommentMeta({ comment }: { comment: Pick<CommentEntity, 'metadata'> }): JSX.Element | null {
    const email = emailOf(comment);
    const ids = (email?.attachments ?? []).map((a) => a.id);
    const files = useAttachments(ids);
    if (!email) return null;
    const inbound = email.direction === 'in';
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-email-comment">
            <span className="imcrm-inline-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                <span
                    className={
                        inbound
                            ? 'imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-bg-info/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-font-medium imcrm-text-[hsl(var(--imcrm-info-ink))]'
                            : 'imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-bg-primary/10 imcrm-px-1.5 imcrm-py-0.5 imcrm-font-medium imcrm-text-[color:var(--imcrm-primary-ink-color)]'
                    }
                >
                    {inbound ? <Inbox className="imcrm-h-3 imcrm-w-3" aria-hidden /> : <Send className="imcrm-h-3 imcrm-w-3" aria-hidden />}
                    {inbound ? __('Correo del cliente') : email.automation ? __('Respuesta automática por correo') : __('Respuesta por correo')}
                </span>
                {email.subject && <span className="imcrm-truncate">«{email.subject}»</span>}
                {!inbound && email.to && <span>→ {email.to}</span>}
                {inbound && email.from && <span>{email.from}</span>}
            </span>
            {(email.attachments ?? []).length > 0 && (
                <ul className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                    {(email.attachments ?? []).map((a) => {
                        const f = files.data?.get(a.id);
                        return (
                            <li key={a.id}>
                                {f ? (
                                    <a
                                        href={f.url}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-border imcrm-border-border imcrm-px-1.5 imcrm-py-0.5 hover:imcrm-bg-muted"
                                    >
                                        <Paperclip className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                        {a.name}
                                    </a>
                                ) : (
                                    <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-border imcrm-border-border imcrm-px-1.5 imcrm-py-0.5">
                                        <Paperclip className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                        {a.name}
                                    </span>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
