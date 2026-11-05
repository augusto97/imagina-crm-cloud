import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiConversationSummary } from '@imagina-base/shared';
import { Check, Loader2, MessageSquarePlus, MessagesSquare, Pencil, Search, Trash2, X } from 'lucide-react';

import { api } from '@/cloud/session';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { relativeTime } from '@/admin/activity/activityText';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export const AI_CONVERSATIONS_KEY = (tenantId: number | null): readonly unknown[] => ['ai-conversations', tenantId];

interface Props {
    tenantId: number | null;
    activeId: string | null;
    onOpen: (id: string) => void;
    onNew: () => void;
    /** Al borrar la conversación abierta, el panel vuelve a una en blanco. */
    onDeleted: (id: string) => void;
    /** Al renombrar la conversación abierta, el encabezado del panel la sigue. */
    onRenamed?: (id: string, title: string) => void;
    /** Barra lateral del modo ancho (sin el botón grande de «Nueva»). */
    compact?: boolean;
}

type Bucket = 'today' | 'yesterday' | 'week' | 'older';
const BUCKET_LABEL: Record<Bucket, string> = {
    today: 'Hoy',
    yesterday: 'Ayer',
    week: 'Últimos 7 días',
    older: 'Antes',
};

/** Hoy / ayer / últimos 7 días / antes, por el día del navegador. */
export function historyBucket(iso: string, now: Date = new Date()): Bucket {
    const t = new Date(iso);
    if (Number.isNaN(t.getTime())) return 'older';
    const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((startOfDay(now) - startOfDay(t)) / 86_400_000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 7) return 'week';
    return 'older';
}

function fold(s: string): string {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * v0.1.370 — El historial de conversaciones con el asistente: las de la
 * persona en esta empresa, de la más reciente a la más vieja.
 */
export function AssistantHistory({ tenantId, activeId, onOpen, onNew, onDeleted, onRenamed, compact = false }: Props): JSX.Element {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const [query, setQuery] = useState('');
    const [renaming, setRenaming] = useState<string | null>(null);
    const [title, setTitle] = useState('');

    const list = useQuery({
        queryKey: AI_CONVERSATIONS_KEY(tenantId),
        queryFn: () => api.aiConversations(),
        enabled: tenantId !== null,
        staleTime: 10_000,
    });

    const rename = useMutation({
        mutationFn: (v: { id: string; title: string }) => api.aiRenameConversation(v.id, v.title),
        onSuccess: (_d, v) => {
            onRenamed?.(v.id, v.title);
            void qc.invalidateQueries({ queryKey: AI_CONVERSATIONS_KEY(tenantId) });
        },
    });
    const remove = useMutation({
        mutationFn: (id: string) => api.aiDeleteConversation(id),
        onSuccess: (_d, id) => {
            onDeleted(id);
            void qc.invalidateQueries({ queryKey: AI_CONVERSATIONS_KEY(tenantId) });
        },
    });

    const groups = useMemo(() => {
        const q = fold(query.trim());
        const items = (list.data?.conversations ?? []).filter((c) => !q || fold(`${c.title} ${c.preview}`).includes(q));
        const out: { bucket: Bucket; items: AiConversationSummary[] }[] = [];
        for (const c of items) {
            const b = historyBucket(c.updated_at);
            const last = out[out.length - 1];
            if (last && last.bucket === b) last.items.push(c);
            else out.push({ bucket: b, items: [c] });
        }
        return out;
    }, [list.data, query]);

    const total = list.data?.conversations.length ?? 0;

    const commitRename = (id: string): void => {
        const t = title.trim();
        setRenaming(null);
        if (t) rename.mutate({ id, title: t.slice(0, 80) });
    };

    const askDelete = async (c: AiConversationSummary): Promise<void> => {
        const ok = await confirm({
            title: __('¿Borrar esta conversación?'),
            description: sprintf(
                /* translators: %s: conversation title */ __('«%s» se borra para siempre. Lo que ya aplicaste desde ella no cambia.'),
                c.title || __('Sin título'),
            ),
            confirmLabel: __('Borrar'),
            destructive: true,
        });
        if (ok) remove.mutate(c.id);
    };

    return (
        <div className="imcrm-flex imcrm-h-full imcrm-min-h-0 imcrm-min-w-0 imcrm-flex-col" data-testid="imcrm-ai-history">
            <div className={cn('imcrm-flex imcrm-shrink-0 imcrm-flex-col imcrm-gap-2', compact ? 'imcrm-p-2' : 'imcrm-px-3 imcrm-pb-2 imcrm-pt-3')}>
                {!compact && (
                    <button
                        type="button"
                        onClick={onNew}
                        className="imcrm-inline-flex imcrm-items-center imcrm-justify-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-font-medium hover:imcrm-border-primary/50 hover:imcrm-bg-primary/5"
                        data-testid="imcrm-ai-history-new"
                    >
                        <MessageSquarePlus className="imcrm-h-4 imcrm-w-4" /> {__('Nueva conversación')}
                    </button>
                )}
                {total > 3 && (
                    <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2.5">
                        <Search className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                        <input
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={__('Buscar en tus conversaciones')}
                            className="imcrm-h-8 imcrm-min-w-0 imcrm-flex-1 imcrm-bg-transparent imcrm-text-sm focus:imcrm-outline-none"
                            data-testid="imcrm-ai-history-search"
                        />
                    </label>
                )}
            </div>
            <div className={cn('imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto', compact ? 'imcrm-px-1.5 imcrm-pb-2' : 'imcrm-px-2 imcrm-pb-3')}>
                {list.isLoading && (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-px-2 imcrm-py-3 imcrm-text-xs imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> {__('Cargando…')}
                    </div>
                )}
                {list.isError && <p className="imcrm-px-2 imcrm-py-3 imcrm-text-xs imcrm-text-destructive">{__('No se pudo cargar el historial.')}</p>}
                {list.isSuccess && total === 0 && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-2 imcrm-px-4 imcrm-py-8 imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">
                        <MessagesSquare className="imcrm-h-6 imcrm-w-6 imcrm-opacity-60" />
                        {__('Todavía no tienes conversaciones. Las que empieces quedan aquí.')}
                    </div>
                )}
                {list.isSuccess && total > 0 && groups.length === 0 && (
                    <p className="imcrm-px-2 imcrm-py-3 imcrm-text-xs imcrm-text-muted-foreground">{__('Ninguna conversación coincide con la búsqueda.')}</p>
                )}
                {groups.map((g) => (
                    <section key={g.bucket} className="imcrm-mb-2">
                        <h3 className="imcrm-m-0 imcrm-px-2 imcrm-pb-1 imcrm-pt-2 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                            {__(BUCKET_LABEL[g.bucket])}
                        </h3>
                        <ul className="imcrm-m-0 imcrm-flex imcrm-list-none imcrm-flex-col imcrm-gap-0.5 imcrm-p-0">
                            {g.items.map((c) => {
                                const active = c.id === activeId;
                                if (renaming === c.id) {
                                    return (
                                        <li key={c.id} className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-lg imcrm-bg-muted/60 imcrm-px-1.5 imcrm-py-1">
                                            <input
                                                autoFocus
                                                value={title}
                                                maxLength={80}
                                                onChange={(e) => setTitle(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') commitRename(c.id);
                                                    if (e.key === 'Escape') {
                                                        e.stopPropagation();
                                                        setRenaming(null);
                                                    }
                                                }}
                                                className="imcrm-h-7 imcrm-min-w-0 imcrm-flex-1 imcrm-rounded imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2 imcrm-text-sm"
                                                aria-label={__('Nombre de la conversación')}
                                                data-testid="imcrm-ai-history-rename-input"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => commitRename(c.id)}
                                                aria-label={__('Guardar')}
                                                className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded hover:imcrm-bg-background"
                                            >
                                                <Check className="imcrm-h-3.5 imcrm-w-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setRenaming(null)}
                                                aria-label={__('Cancelar')}
                                                className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded hover:imcrm-bg-background"
                                            >
                                                <X className="imcrm-h-3.5 imcrm-w-3.5" />
                                            </button>
                                        </li>
                                    );
                                }
                                return (
                                    <li key={c.id} className="imcrm-group imcrm-relative imcrm-min-w-0">
                                        <button
                                            type="button"
                                            onClick={() => onOpen(c.id)}
                                            aria-current={active ? 'true' : undefined}
                                            className={cn(
                                                'imcrm-flex imcrm-w-full imcrm-flex-col imcrm-gap-0.5 imcrm-rounded-lg imcrm-px-2 imcrm-py-1.5 imcrm-pr-16 imcrm-text-left imcrm-transition-colors',
                                                active ? 'imcrm-bg-primary/10' : 'hover:imcrm-bg-muted/70',
                                            )}
                                            data-testid="imcrm-ai-history-item"
                                        >
                                            <span className={cn('imcrm-truncate imcrm-text-sm', active ? 'imcrm-font-medium imcrm-text-primary' : 'imcrm-text-foreground')}>
                                                {c.title || __('Sin título')}
                                            </span>
                                            {!compact && c.preview && <span className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{c.preview}</span>}
                                            <span className="imcrm-text-[11px] imcrm-text-muted-foreground" title={new Date(c.updated_at).toLocaleString()}>
                                                {relativeTime(c.updated_at)}
                                            </span>
                                        </button>
                                        <div className="imcrm-absolute imcrm-right-1 imcrm-top-1 imcrm-flex imcrm-gap-0.5 imcrm-opacity-100 [@media(hover:hover)]:imcrm-opacity-0 [@media(hover:hover)]:group-hover:imcrm-opacity-100 [@media(hover:hover)]:group-focus-within:imcrm-opacity-100">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setTitle(c.title);
                                                    setRenaming(c.id);
                                                }}
                                                aria-label={__('Cambiar el nombre')}
                                                title={__('Cambiar el nombre')}
                                                className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-background hover:imcrm-text-foreground"
                                                data-testid="imcrm-ai-history-rename"
                                            >
                                                <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => void askDelete(c)}
                                                aria-label={__('Borrar')}
                                                title={__('Borrar')}
                                                className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-background hover:imcrm-text-destructive"
                                                data-testid="imcrm-ai-history-delete"
                                            >
                                                <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                            </button>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                ))}
            </div>
            {list.data && total > 0 && (
                <p className="imcrm-m-0 imcrm-shrink-0 imcrm-border-t imcrm-border-border imcrm-px-3 imcrm-py-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                    {sprintf(/* translators: %d: days */ __('Cada conversación se guarda %d días desde su último mensaje.'), list.data.keep_days)}
                </p>
            )}
        </div>
    );
}
