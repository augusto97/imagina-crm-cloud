import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiChatEvent, AiProposal, AiStatus } from '@imagina-base/shared';
import { Loader2, MessageSquarePlus, Send, Settings, Sparkles, Square, X } from 'lucide-react';
import { Link, useLocation } from 'react-router';

import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { ProposalCard } from './ProposalCard';
import { assistantPanel, readConversationId, useAssistantPanelOpen, writeConversationId } from './assistantPanelStore';

interface UiMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    proposals: AiProposal[];
    /** Sólo mientras el modelo habla: qué herramienta está corriendo. */
    working?: string | null;
    error?: string | null;
}

const SUGGESTIONS = [
    'Armame una lista de proveedores con contacto, categoría, estado y saldo pendiente',
    'Creá un tablero con los indicadores más útiles de esta lista',
    'Agregale a esta lista un campo de prioridad (alta, media, baja) con colores',
    'Cuando cambie el estado a "Ganado", mandá un correo al responsable',
];

/**
 * Panel del asistente IA (ADR-S21). Un drawer a la derecha que se abre desde
 * el Topbar. Habla por SSE con `/ai/chat`: el texto llega en vivo y las
 * herramientas `propose_*` aparecen como TARJETAS con botón "Aplicar" — el
 * asistente nunca escribe solo. La conversación se continúa por id
 * (guardado por pestaña + empresa); "Nueva conversación" la descarta.
 */
export function AssistantPanel(): JSX.Element | null {
    const open = useAssistantPanelOpen();
    const tenantId = useSession((s) => s.activeTenantId);
    const location = useLocation();
    const listSlug = useMemo(() => /^\/lists\/([^/?#]+)/.exec(location.pathname)?.[1] ?? undefined, [location.pathname]);

    const status = useQuery({
        queryKey: ['ai-status', tenantId],
        queryFn: () => api.aiStatus(),
        enabled: open && tenantId !== null,
        retry: false,
        staleTime: 30_000,
    });

    const [conversationId, setConversationId] = useState<string | null>(() => readConversationId(tenantId));
    const [messages, setMessages] = useState<UiMessage[]>([]);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const abortRef = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const qc = useQueryClient();

    // Cambio de empresa → otra conversación (o ninguna).
    useEffect(() => {
        setConversationId(readConversationId(tenantId));
        setMessages([]);
    }, [tenantId]);

    // Al abrir con una conversación recordada y sin mensajes en memoria, se
    // recupera el transcript del servidor (dura 24 h).
    useEffect(() => {
        if (!open || !conversationId || messages.length > 0) return;
        let cancelled = false;
        api.aiConversation(conversationId)
            .then((conv) => {
                if (cancelled) return;
                setMessages(
                    conv.messages.map((m, i) => ({ id: `h${i}`, role: m.role, text: m.text, proposals: m.proposals })),
                );
            })
            .catch(() => {
                if (cancelled) return;
                writeConversationId(tenantId, null);
                setConversationId(null);
            });
        return () => {
            cancelled = true;
        };
    }, [open, conversationId, messages.length, tenantId]);

    useEffect(() => {
        if (!open) return;
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages, open]);

    useEffect(() => {
        if (!open) return;
        // El panel vive montado todo el tiempo (devuelve null cerrado): al
        // abrir se re-lee el id recordado, que otra pestaña o un "Nueva
        // conversación" pudieron cambiar.
        if (messages.length === 0) {
            const remembered = readConversationId(tenantId);
            if (remembered !== conversationId) setConversationId(remembered);
        }
        setTimeout(() => inputRef.current?.focus(), 50);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al abrir
    }, [open]);

    const patchLast = useCallback((fn: (m: UiMessage) => UiMessage) => {
        setMessages((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1]!;
            return [...prev.slice(0, -1), fn(last)];
        });
    }, []);

    const send = useCallback(
        async (text: string) => {
            const message = text.trim();
            if (!message || busy) return;
            setDraft('');
            setBusy(true);
            const userMsg: UiMessage = { id: `u${Date.now()}`, role: 'user', text: message, proposals: [] };
            const asstMsg: UiMessage = { id: `a${Date.now()}`, role: 'assistant', text: '', proposals: [], working: null };
            setMessages((prev) => [...prev, userMsg, asstMsg]);
            const ac = new AbortController();
            abortRef.current = ac;
            const onEvent = (ev: AiChatEvent): void => {
                switch (ev.type) {
                    case 'start':
                        setConversationId(ev.conversation_id);
                        writeConversationId(tenantId, ev.conversation_id);
                        break;
                    case 'text_delta':
                        patchLast((m) => ({ ...m, text: m.text + ev.text, working: null }));
                        break;
                    case 'tool_start':
                        patchLast((m) => ({ ...m, working: ev.label }));
                        break;
                    case 'tool_end':
                        patchLast((m) => ({ ...m, working: null }));
                        break;
                    case 'proposal':
                        patchLast((m) => ({ ...m, proposals: [...m.proposals, ev.proposal] }));
                        break;
                    case 'error':
                        patchLast((m) => ({ ...m, error: ev.message, working: null }));
                        break;
                    case 'done':
                        void qc.invalidateQueries({ queryKey: ['ai-status', tenantId] });
                        break;
                }
            };
            try {
                await api.aiChat({ message, conversation_id: conversationId ?? undefined, context: { list_slug: listSlug, route: location.pathname } }, onEvent, ac.signal);
            } catch (err) {
                if ((err as { name?: string }).name !== 'AbortError') {
                    const msg = err instanceof CloudApiError || err instanceof Error ? err.message : __('No se pudo hablar con el asistente');
                    patchLast((m) => ({ ...m, error: msg, working: null }));
                }
            } finally {
                patchLast((m) => ({ ...m, working: null }));
                abortRef.current = null;
                setBusy(false);
            }
        },
        [busy, conversationId, listSlug, location.pathname, patchLast, qc, tenantId],
    );

    const stop = (): void => abortRef.current?.abort();

    const reset = (): void => {
        abortRef.current?.abort();
        writeConversationId(tenantId, null);
        setConversationId(null);
        setMessages([]);
        setDraft('');
    };

    const onApplied = (updated: AiProposal): void => {
        setMessages((prev) => prev.map((m) => ({ ...m, proposals: m.proposals.map((p) => (p.id === updated.id ? updated : p)) })));
    };

    if (!open) return null;
    const st: AiStatus | undefined = status.data;
    const unavailable = st && !st.available;
    const canType = Boolean(st?.available) && !busy;

    return (
        <aside
            data-testid="imcrm-ai-panel"
            role="dialog"
            aria-label={__('Asistente IA')}
            className="imcrm-fixed imcrm-inset-y-0 imcrm-right-0 imcrm-z-40 imcrm-flex imcrm-w-full imcrm-flex-col imcrm-border-l imcrm-border-border imcrm-bg-background imcrm-shadow-xl sm:imcrm-w-[440px]"
        >
            <header className="imcrm-flex imcrm-h-12 imcrm-shrink-0 imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-3">
                <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary">
                    <Sparkles className="imcrm-h-4 imcrm-w-4" />
                </span>
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <div className="imcrm-text-sm imcrm-font-semibold imcrm-leading-tight">{__('Asistente')}</div>
                    <div className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                        {st?.available
                            ? st.usage.limit === null
                                ? __('Pedidos ilimitados')
                                : `${st.usage.used} / ${st.usage.limit} ${__('pedidos este mes')}`
                            : __('Proponé, revisá, aplicá')}
                    </div>
                </div>
                <Button variant="ghost" size="icon" aria-label={__('Nueva conversación')} title={__('Nueva conversación')} onClick={reset} disabled={messages.length === 0 && !busy}>
                    <MessageSquarePlus className="imcrm-h-4 imcrm-w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={__('Cerrar')} onClick={assistantPanel.close} data-testid="imcrm-ai-close">
                    <X className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </header>

            <div ref={scrollRef} className="imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-3 imcrm-py-3">
                {status.isLoading && (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                        <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Comprobando el asistente…')}
                    </div>
                )}
                {status.isError && (
                    <p className="imcrm-text-sm imcrm-text-destructive">
                        {status.error instanceof Error ? status.error.message : __('No se pudo comprobar el asistente')}
                    </p>
                )}
                {unavailable && (
                    <div className="imcrm-rounded-xl imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-p-3 imcrm-text-sm" data-testid="imcrm-ai-unavailable">
                        <div className="imcrm-font-medium">{__('El asistente no está disponible')}</div>
                        <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">{st!.reason}</p>
                        {st!.can_configure && (
                            <Link to="/settings?s=asistente" className="imcrm-mt-2 imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline" onClick={assistantPanel.close}>
                                <Settings className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Configurar el asistente')}
                            </Link>
                        )}
                    </div>
                )}
                {st?.available && messages.length === 0 && (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">
                            {__('Pedime en tus palabras una lista, campos, una vista, un tablero o una automatización. Te muestro una vista previa y vos decidís si se aplica.')}
                        </p>
                        {SUGGESTIONS.map((s) => (
                            <button
                                key={s}
                                type="button"
                                onClick={() => void send(s)}
                                className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-text-xs imcrm-text-foreground/90 imcrm-transition-colors hover:imcrm-border-primary/40 hover:imcrm-bg-primary/5"
                            >
                                {__(s)}
                            </button>
                        ))}
                    </div>
                )}
                <ol className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    {messages.map((m) => (
                        <li key={m.id} className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2', m.role === 'user' ? 'imcrm-items-end' : 'imcrm-items-stretch')} data-role={m.role}>
                            {m.role === 'user' ? (
                                <div className="imcrm-max-w-[85%] imcrm-whitespace-pre-wrap imcrm-rounded-2xl imcrm-rounded-br-md imcrm-bg-primary imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-primary-foreground">{m.text}</div>
                            ) : (
                                <>
                                    {(m.text || (!m.working && !m.error && m.proposals.length === 0)) && (
                                        <div className="imcrm-whitespace-pre-wrap imcrm-text-sm imcrm-leading-relaxed" data-testid="imcrm-ai-text">
                                            {m.text || (busy ? '' : '…')}
                                        </div>
                                    )}
                                    {m.proposals.map((p) => (
                                        <ProposalCard key={p.id} proposal={p} onApplied={onApplied} />
                                    ))}
                                    {m.working !== undefined && m.working !== null && (
                                        <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-ai-working">
                                            <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> {m.working}…
                                        </div>
                                    )}
                                    {m.working === null && busy && m.id === messages[messages.length - 1]?.id && !m.text && (
                                        <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                                            <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> {__('Pensando…')}
                                        </div>
                                    )}
                                    {m.error && (
                                        <div className="imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/10 imcrm-px-2.5 imcrm-py-1.5 imcrm-text-xs imcrm-text-destructive" data-testid="imcrm-ai-error">
                                            {m.error}
                                        </div>
                                    )}
                                </>
                            )}
                        </li>
                    ))}
                </ol>
            </div>

            <form
                className="imcrm-shrink-0 imcrm-border-t imcrm-border-border imcrm-p-3"
                onSubmit={(e) => {
                    e.preventDefault();
                    void send(draft);
                }}
            >
                <div className="imcrm-flex imcrm-items-end imcrm-gap-2">
                    <Textarea
                        ref={inputRef}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                void send(draft);
                            }
                        }}
                        placeholder={st?.available ? __('Pedí algo… (Enter envía, Shift+Enter salto de línea)') : __('El asistente no está disponible')}
                        disabled={!st?.available}
                        rows={2}
                        className="imcrm-min-h-[44px] imcrm-max-h-40 imcrm-resize-none"
                        data-testid="imcrm-ai-input"
                    />
                    {busy ? (
                        <Button type="button" size="icon" variant="outline" aria-label={__('Detener')} onClick={stop}>
                            <Square className="imcrm-h-4 imcrm-w-4" />
                        </Button>
                    ) : (
                        <Button type="submit" size="icon" aria-label={__('Enviar')} disabled={!canType || !draft.trim()} data-testid="imcrm-ai-send">
                            <Send className="imcrm-h-4 imcrm-w-4" />
                        </Button>
                    )}
                </div>
                <p className="imcrm-mt-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('El asistente propone; nada cambia hasta que aplicás una tarjeta.')}
                </p>
            </form>
        </aside>
    );
}
