import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { aiConversationTitle, type AiChatEvent, type AiConversation, type AiProposal, type AiStatus } from '@imagina-base/shared';
import {
    ArrowDown,
    BarChart3,
    Blocks,
    History,
    LayoutDashboard,
    Loader2,
    Maximize2,
    MessageSquarePlus,
    Minimize2,
    Pencil,
    Send,
    Settings,
    Sparkles,
    Square,
    X,
    Zap,
} from 'lucide-react';
import { Link, useLocation } from 'react-router';

import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { CloudApiError } from '@/lib/cloud/client';
import { effortLabel } from '@/lib/aiModels';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { AI_CONVERSATIONS_KEY, AssistantHistory } from './AssistantHistory';
import { AssistantMessage, type UiMessage } from './AssistantMessage';
import { screenContext, suggestionsFor, type SuggestionKind } from './assistantContext';
import { assistantPanel, assistantWide, readConversationId, useAssistantPanelOpen, useAssistantWide, writeConversationId } from './assistantPanelStore';

const KIND_ICON: Record<SuggestionKind, typeof BarChart3> = {
    data: BarChart3,
    build: Blocks,
    automate: Zap,
    design: LayoutDashboard,
};

/** El transcript guardado → los mensajes de la UI. */
function fromConversation(conv: AiConversation): UiMessage[] {
    return conv.messages.map((m, i) => ({
        id: `h${i}`,
        role: m.role,
        text: m.text,
        proposals: m.proposals,
        steps: m.steps.map((s) => ({ ...s })),
        error: m.error,
        at: m.at,
    }));
}

/** Hasta dónde queda la conversación si se rehace el último pedido. */
function beforeLastUserMessage(messages: UiMessage[]): UiMessage[] {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'user') return messages.slice(0, i);
    return messages;
}

const STICK_PX = 96;

/**
 * Panel del asistente IA (ADR-S21; rediseño v0.1.370). Un panel a la
 * derecha que se abre desde el Topbar. Habla por SSE con `/ai/chat`: el
 * texto llega en vivo con su formato, cada herramienta que usa queda como un
 * paso, y las `propose_*` aparecen como TARJETAS con «Aplicar» — el
 * asistente nunca escribe solo. Las conversaciones se guardan en el
 * servidor (historial) y la abierta se recuerda por pestaña y empresa.
 */
export function AssistantPanel(): JSX.Element | null {
    const open = useAssistantPanelOpen();
    const tenantId = useSession((s) => s.activeTenantId);
    const location = useLocation();
    const screen = useMemo(() => screenContext(location.pathname), [location.pathname]);
    const suggestions = useMemo(() => suggestionsFor(screen), [screen]);
    const desktop = useMediaQuery('(min-width: 1024px)');
    const wide = useAssistantWide();
    const sidebar = wide && desktop;

    const status = useQuery({
        queryKey: ['ai-status', tenantId],
        queryFn: () => api.aiStatus(),
        enabled: open && tenantId !== null,
        retry: false,
        staleTime: 30_000,
    });

    const [conversationId, setConversationId] = useState<string | null>(() => readConversationId(tenantId));
    const [title, setTitle] = useState('');
    const [messages, setMessages] = useState<UiMessage[]>([]);
    const [loadingConv, setLoadingConv] = useState(false);
    const [draft, setDraft] = useState('');
    const [busy, setBusy] = useState(false);
    const [view, setView] = useState<'chat' | 'history'>('chat');
    const [editing, setEditing] = useState(false);
    const [atBottom, setAtBottom] = useState(true);
    const abortRef = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLTextAreaElement | null>(null);
    const stickRef = useRef(true);
    const focusEndRef = useRef(false);
    const qc = useQueryClient();

    const load = useCallback(
        (id: string) => {
            setLoadingConv(true);
            api.aiConversation(id)
                .then((conv) => {
                    setConversationId(conv.id);
                    writeConversationId(tenantId, conv.id);
                    setTitle(conv.title);
                    setMessages(fromConversation(conv));
                    stickRef.current = true;
                })
                .catch(() => {
                    writeConversationId(tenantId, null);
                    setConversationId(null);
                    setTitle('');
                    setMessages([]);
                })
                .finally(() => setLoadingConv(false));
        },
        [tenantId],
    );

    // Cambio de empresa → otra conversación (o ninguna).
    useEffect(() => {
        abortRef.current?.abort();
        setConversationId(readConversationId(tenantId));
        setTitle('');
        setMessages([]);
        setView('chat');
    }, [tenantId]);

    // Al abrir con una conversación recordada y sin mensajes en memoria, se
    // recupera del servidor.
    useEffect(() => {
        if (!open || !conversationId || messages.length > 0 || busy || loadingConv) return;
        load(conversationId);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo cuando cambia qué hay que mostrar
    }, [open, conversationId]);

    useEffect(() => {
        if (!open) return;
        // El panel vive montado todo el tiempo (devuelve null cerrado): al
        // abrir se re-lee el id recordado, que otra pestaña pudo cambiar.
        if (messages.length === 0) {
            const remembered = readConversationId(tenantId);
            if (remembered !== conversationId) setConversationId(remembered);
        }
        stickRef.current = true;
        setTimeout(() => inputRef.current?.focus(), 50);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al abrir
    }, [open]);

    // Seguir el final mientras llega la respuesta, salvo que la persona haya
    // subido a leer algo.
    useLayoutEffect(() => {
        if (!open || view !== 'chat') return;
        const el = scrollRef.current;
        if (el && stickRef.current) el.scrollTop = el.scrollHeight;
    }, [messages, open, view]);

    const onScroll = (): void => {
        const el = scrollRef.current;
        if (!el) return;
        const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
        stickRef.current = near;
        if (near !== atBottom) setAtBottom(near);
    };

    const toBottom = (): void => {
        const el = scrollRef.current;
        if (!el) return;
        stickRef.current = true;
        setAtBottom(true);
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    };

    // El cuadro de texto crece con lo que se escribe (hasta un tope). Al
    // editar el último pedido, el cursor va al final en el MISMO render (con
    // un timeout, lo que la persona escribiera enseguida se pegaba al final).
    useLayoutEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
        if (focusEndRef.current) {
            focusEndRef.current = false;
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
        }
    }, [draft, open, view]);

    const patchLast = useCallback((fn: (m: UiMessage) => UiMessage) => {
        setMessages((prev) => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1]!;
            return [...prev.slice(0, -1), fn(last)];
        });
    }, []);

    const send = useCallback(
        async (text: string, opts: { regenerate?: boolean } = {}) => {
            const message = text.trim();
            if (!message || busy) return;
            const regenerate = Boolean(opts.regenerate && conversationId);
            setDraft('');
            setEditing(false);
            setBusy(true);
            setView('chat');
            stickRef.current = true;
            setAtBottom(true);
            const now = Date.now();
            const userMsg: UiMessage = {
                id: `u${now}`,
                role: 'user',
                text: message,
                proposals: [],
                steps: [],
                error: null,
            };
            const asstMsg: UiMessage = {
                id: `a${now}`,
                role: 'assistant',
                text: '',
                proposals: [],
                steps: [],
                error: null,
                streaming: true,
            };
            setMessages((prev) => [...(regenerate ? beforeLastUserMessage(prev) : prev), userMsg, asstMsg]);
            if (!conversationId) setTitle(aiConversationTitle(message));
            const ac = new AbortController();
            abortRef.current = ac;
            const onEvent = (ev: AiChatEvent): void => {
                switch (ev.type) {
                    case 'start':
                        setConversationId(ev.conversation_id);
                        writeConversationId(tenantId, ev.conversation_id);
                        break;
                    case 'text_delta':
                        patchLast((m) => ({ ...m, text: m.text + ev.text }));
                        break;
                    case 'tool_start':
                        patchLast((m) => ({
                            ...m,
                            steps: [...m.steps, { name: ev.name, label: ev.label, ok: null, summary: '' }],
                        }));
                        break;
                    case 'tool_end':
                        patchLast((m) => {
                            const steps = [...m.steps];
                            for (let i = steps.length - 1; i >= 0; i--) {
                                if (steps[i]!.name === ev.name && steps[i]!.ok === null) {
                                    steps[i] = { ...steps[i]!, ok: ev.ok, summary: ev.summary };
                                    break;
                                }
                            }
                            return { ...m, steps };
                        });
                        break;
                    case 'proposal':
                        patchLast((m) => ({
                            ...m,
                            proposals: [...m.proposals, ev.proposal],
                        }));
                        break;
                    case 'error':
                        patchLast((m) => ({ ...m, error: ev.message }));
                        break;
                    case 'done':
                        void qc.invalidateQueries({ queryKey: ['ai-status', tenantId] });
                        break;
                }
            };
            try {
                await api.aiChat(
                    {
                        message,
                        conversation_id: conversationId ?? undefined,
                        ...(regenerate ? { regenerate: true } : {}),
                        context: {
                            list_slug: screen.listSlug,
                            route: location.pathname.slice(0, 200),
                            record_id: screen.recordId,
                        },
                    },
                    onEvent,
                    ac.signal,
                );
            } catch (err) {
                if ((err as { name?: string }).name === 'AbortError') {
                    patchLast((m) => ({
                        ...m,
                        error: m.error ?? __('Lo detuviste antes de que terminara.'),
                    }));
                } else {
                    const msg = err instanceof CloudApiError || err instanceof Error ? err.message : __('No se pudo hablar con el asistente');
                    patchLast((m) => ({ ...m, error: msg }));
                }
            } finally {
                // Un paso que quedó a medias (se cortó) se marca como no terminado.
                patchLast((m) => ({
                    ...m,
                    streaming: false,
                    steps: m.steps.map((s) => (s.ok === null ? { ...s, ok: false, summary: __('No terminó') } : s)),
                }));
                abortRef.current = null;
                setBusy(false);
                void qc.invalidateQueries({ queryKey: AI_CONVERSATIONS_KEY(tenantId) });
            }
        },
        [busy, conversationId, location.pathname, patchLast, qc, screen.listSlug, screen.recordId, tenantId],
    );

    const lastUser = useMemo(() => {
        for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.role === 'user') return { index: i, text: messages[i]!.text };
        return null;
    }, [messages]);

    const retry = useCallback(() => {
        if (lastUser) void send(lastUser.text, { regenerate: true });
    }, [lastUser, send]);

    const startEdit = useCallback(() => {
        if (!lastUser) return;
        focusEndRef.current = true;
        setDraft(lastUser.text);
        setEditing(true);
    }, [lastUser]);

    const stop = (): void => abortRef.current?.abort();

    const reset = (): void => {
        abortRef.current?.abort();
        writeConversationId(tenantId, null);
        setConversationId(null);
        setTitle('');
        setMessages([]);
        setDraft('');
        setEditing(false);
        setView('chat');
        setTimeout(() => inputRef.current?.focus(), 30);
    };

    const openConversation = (id: string): void => {
        setView('chat');
        if (id === conversationId && messages.length > 0) return;
        abortRef.current?.abort();
        setMessages([]);
        setEditing(false);
        load(id);
    };

    const onDeleted = (id: string): void => {
        if (id === conversationId) reset();
    };

    const onApplied = useCallback((updated: AiProposal): void => {
        setMessages((prev) =>
            prev.map((m) => ({
                ...m,
                proposals: m.proposals.map((p) => (p.id === updated.id ? updated : p)),
            })),
        );
    }, []);

    if (!open) return null;
    const st: AiStatus | undefined = status.data;
    const unavailable = st && !st.available;
    const canType = Boolean(st?.available) && !busy;

    const history = (
        <AssistantHistory
            tenantId={tenantId}
            activeId={conversationId}
            onOpen={openConversation}
            onNew={reset}
            onDeleted={onDeleted}
            onRenamed={(id, t) => {
                if (id === conversationId) setTitle(t);
            }}
            compact={sidebar}
        />
    );

    return (
        <aside
            data-testid="imcrm-ai-panel"
            data-tour="assistant-panel"
            data-wide={sidebar ? '1' : undefined}
            role="dialog"
            aria-label={__('Asistente IA')}
            onKeyDown={(e) => {
                if (e.key !== 'Escape' || e.defaultPrevented) return;
                if (editing) {
                    setEditing(false);
                    setDraft('');
                } else if (view === 'history' && !sidebar) setView('chat');
                else assistantPanel.close();
            }}
            className={cn(
                'imcrm-fixed imcrm-inset-y-0 imcrm-right-0 imcrm-z-40 imcrm-flex imcrm-w-full imcrm-flex-col imcrm-border-l imcrm-border-border imcrm-bg-background imcrm-shadow-xl imcrm-transition-[width] imcrm-duration-200',
                sidebar ? 'lg:imcrm-w-[min(1040px,82vw)]' : 'sm:imcrm-w-[460px]',
            )}
        >
            <header className="imcrm-flex imcrm-h-12 imcrm-shrink-0 imcrm-items-center imcrm-gap-1 imcrm-border-b imcrm-border-border imcrm-px-2">
                {!sidebar && (
                    <Button
                        variant={view === 'history' ? 'secondary' : 'ghost'}
                        size="icon"
                        aria-label={__('Conversaciones')}
                        title={__('Conversaciones')}
                        aria-pressed={view === 'history'}
                        onClick={() => setView((v) => (v === 'history' ? 'chat' : 'history'))}
                        data-testid="imcrm-ai-history-toggle"
                        data-tour="assistant-history"
                    >
                        <History className="imcrm-h-4 imcrm-w-4" />
                    </Button>
                )}
                <span className="imcrm-ml-1 imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary">
                    <Sparkles className="imcrm-h-4 imcrm-w-4" />
                </span>
                <div className="imcrm-ml-1 imcrm-min-w-0 imcrm-flex-1">
                    <div className="imcrm-truncate imcrm-text-sm imcrm-font-semibold imcrm-leading-tight" data-testid="imcrm-ai-title" title={title || undefined}>
                        {view === 'history' && !sidebar ? __('Tus conversaciones') : title || __('Asistente')}
                    </div>
                    <div className="imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground" title={st?.model_name ?? undefined} data-testid="imcrm-ai-subtitle">
                        {st?.available
                            ? [
                                  st.model_name,
                                  st.effort ? sprintf(/* translators: %s: effort level */ __('esfuerzo %s'), effortLabel(st.effort).toLowerCase()) : null,
                                  st.usage.limit === null
                                      ? __('Pedidos ilimitados')
                                      : sprintf(/* translators: 1: used, 2: limit */ __('%1$d/%2$d pedidos este mes'), st.usage.used, st.usage.limit),
                              ]
                                  .filter(Boolean)
                                  .join(' · ')
                            : __('Propón, revisa, aplica')}
                    </div>
                </div>
                {desktop && (
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label={wide ? __('Panel angosto') : __('Panel ancho')}
                        title={wide ? __('Panel angosto') : __('Panel ancho, con tus conversaciones al lado')}
                        aria-pressed={wide}
                        onClick={() => assistantWide.set(!wide)}
                        data-testid="imcrm-ai-wide"
                        data-tour="assistant-wide"
                    >
                        {wide ? <Minimize2 className="imcrm-h-4 imcrm-w-4" /> : <Maximize2 className="imcrm-h-4 imcrm-w-4" />}
                    </Button>
                )}
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label={__('Nueva conversación')}
                    title={__('Nueva conversación')}
                    onClick={reset}
                    disabled={messages.length === 0 && !busy && view === 'chat'}
                    data-testid="imcrm-ai-new"
                >
                    <MessageSquarePlus className="imcrm-h-4 imcrm-w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={__('Cerrar')} onClick={assistantPanel.close} data-testid="imcrm-ai-close">
                    <X className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </header>

            <div className="imcrm-flex imcrm-min-h-0 imcrm-flex-1">
                {sidebar && (
                    <div className="imcrm-flex imcrm-w-64 imcrm-shrink-0 imcrm-flex-col imcrm-border-r imcrm-border-border imcrm-bg-muted/20" data-tour="assistant-history">
                        <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-between imcrm-px-3 imcrm-pt-2.5">
                            <span className="imcrm-text-xs imcrm-font-semibold imcrm-text-muted-foreground">{__('Tus conversaciones')}</span>
                        </div>
                        {history}
                    </div>
                )}
                {!sidebar && view === 'history' ? (
                    <div className="imcrm-min-h-0 imcrm-min-w-0 imcrm-flex-1">{history}</div>
                ) : (
                    <div className="imcrm-relative imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                        <div className="imcrm-relative imcrm-min-h-0 imcrm-flex-1">
                            <div ref={scrollRef} onScroll={onScroll} className="imcrm-h-full imcrm-overflow-y-auto" data-testid="imcrm-ai-scroll">
                                <div
                                    className={cn(
                                        'imcrm-mx-auto imcrm-flex imcrm-w-full imcrm-flex-col imcrm-gap-4 imcrm-px-4 imcrm-py-4',
                                        sidebar && 'imcrm-max-w-3xl imcrm-px-6',
                                    )}
                                >
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
                                        <div
                                            className="imcrm-rounded-xl imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-p-3 imcrm-text-sm"
                                            data-testid="imcrm-ai-unavailable"
                                        >
                                            <div className="imcrm-font-medium">{__('El asistente no está disponible')}</div>
                                            <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">{st!.reason}</p>
                                            {st!.can_configure && (
                                                <Link
                                                    to="/settings?s=asistente"
                                                    className="imcrm-mt-2 imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                                                    onClick={assistantPanel.close}
                                                >
                                                    <Settings className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Configurar el asistente')}
                                                </Link>
                                            )}
                                        </div>
                                    )}
                                    {loadingConv && messages.length === 0 && (
                                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                                            <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> {__('Abriendo la conversación…')}
                                        </div>
                                    )}
                                    {st?.available && messages.length === 0 && !loadingConv && (
                                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-pt-2" data-testid="imcrm-ai-empty">
                                            <div className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-2">
                                                <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-items-center imcrm-justify-center imcrm-rounded-2xl imcrm-bg-primary/10 imcrm-text-primary">
                                                    <Sparkles className="imcrm-h-5 imcrm-w-5" />
                                                </span>
                                                <h2 className="imcrm-m-0 imcrm-text-lg imcrm-font-semibold">{__('¿En qué te ayudo?')}</h2>
                                                <p className="imcrm-m-0 imcrm-text-sm imcrm-leading-relaxed imcrm-text-muted-foreground">
                                                    {__(
                                                        'Pregúntame por tus datos o pídeme en tus palabras una lista, campos, una vista, un tablero o una automatización. Te muestro una vista previa y tú decides si se aplica.',
                                                    )}
                                                </p>
                                            </div>
                                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid="imcrm-ai-suggestions">
                                                <span className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                                    {__(suggestions.title)}
                                                </span>
                                                <div className={cn('imcrm-grid imcrm-gap-2', sidebar && 'sm:imcrm-grid-cols-2')}>
                                                    {suggestions.items.map((s) => {
                                                        const Icon = KIND_ICON[s.kind];
                                                        return (
                                                            <button
                                                                key={s.text}
                                                                type="button"
                                                                onClick={() => void send(__(s.text))}
                                                                className="imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-3 imcrm-py-2.5 imcrm-text-left imcrm-text-[13px] imcrm-leading-snug imcrm-text-foreground/90 imcrm-transition-colors hover:imcrm-border-primary/40 hover:imcrm-bg-primary/5"
                                                                data-testid="imcrm-ai-suggestion"
                                                            >
                                                                <Icon className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" />
                                                                <span>{__(s.text)}</span>
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                    {messages.length > 0 && (
                                        <ol className="imcrm-m-0 imcrm-flex imcrm-list-none imcrm-flex-col imcrm-gap-5 imcrm-p-0" data-testid="imcrm-ai-messages">
                                            {messages.map((m, i) => (
                                                <AssistantMessage
                                                    key={m.id}
                                                    m={m}
                                                    last={m.role === 'user' ? lastUser?.index === i : i === messages.length - 1}
                                                    busy={busy}
                                                    onRetry={retry}
                                                    onEdit={startEdit}
                                                    onApplied={onApplied}
                                                    onNavigate={desktop ? () => undefined : assistantPanel.close}
                                                />
                                            ))}
                                        </ol>
                                    )}
                                </div>
                            </div>
                            {!atBottom && messages.length > 0 && (
                                <button
                                    type="button"
                                    onClick={toBottom}
                                    className="imcrm-absolute imcrm-bottom-3 imcrm-left-1/2 imcrm-inline-flex imcrm--translate-x-1/2 imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-3 imcrm-py-1 imcrm-text-xs imcrm-shadow-md hover:imcrm-bg-muted"
                                    data-testid="imcrm-ai-to-bottom"
                                >
                                    <ArrowDown className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Ir al final')}
                                </button>
                            )}
                        </div>
                        <form
                            data-tour="assistant-input"
                            className={cn(
                                'imcrm-shrink-0 imcrm-border-t imcrm-border-border imcrm-px-3 imcrm-pt-2.5 imcrm-pb-[max(0.75rem,env(safe-area-inset-bottom))]',
                                sidebar && 'imcrm-px-6',
                            )}
                            onSubmit={(e) => {
                                e.preventDefault();
                                void send(draft, { regenerate: editing });
                            }}
                        >
                            <div className={cn('imcrm-mx-auto imcrm-w-full', sidebar && 'imcrm-max-w-3xl')}>
                                {editing && (
                                    <div
                                        className="imcrm-mb-2 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-bg-muted/60 imcrm-px-2.5 imcrm-py-1.5 imcrm-text-xs"
                                        data-testid="imcrm-ai-editing"
                                    >
                                        <Pencil className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" />
                                        <span className="imcrm-flex-1">{__('Editando tu último pedido: al enviarlo, se rehace la respuesta.')}</span>
                                        <button
                                            type="button"
                                            className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                                            onClick={() => {
                                                setEditing(false);
                                                setDraft('');
                                            }}
                                        >
                                            {__('Cancelar')}
                                        </button>
                                    </div>
                                )}
                                <div className="imcrm-flex imcrm-items-end imcrm-gap-2 imcrm-rounded-2xl imcrm-border imcrm-border-input imcrm-bg-background imcrm-p-1.5 imcrm-pl-3 focus-within:imcrm-ring-2 focus-within:imcrm-ring-ring/40">
                                    <textarea
                                        ref={inputRef}
                                        value={draft}
                                        onChange={(e) => setDraft(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                                                e.preventDefault();
                                                void send(draft, { regenerate: editing });
                                            }
                                        }}
                                        placeholder={st?.available ? __('Pide algo o haz una pregunta…') : __('El asistente no está disponible')}
                                        disabled={!st?.available}
                                        rows={1}
                                        maxLength={4000}
                                        aria-label={__('Mensaje para el asistente')}
                                        className="imcrm-max-h-[200px] imcrm-min-h-[36px] imcrm-flex-1 imcrm-resize-none imcrm-bg-transparent imcrm-py-2 imcrm-text-sm imcrm-leading-snug placeholder:imcrm-text-muted-foreground focus:imcrm-outline-none disabled:imcrm-cursor-not-allowed"
                                        data-testid="imcrm-ai-input"
                                    />
                                    {busy ? (
                                        <Button
                                            type="button"
                                            size="icon"
                                            variant="outline"
                                            className="imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-rounded-xl"
                                            aria-label={__('Detener')}
                                            title={__('Detener')}
                                            onClick={stop}
                                            data-testid="imcrm-ai-stop"
                                        >
                                            <Square className="imcrm-h-3.5 imcrm-w-3.5 imcrm-fill-current" />
                                        </Button>
                                    ) : (
                                        <Button
                                            type="submit"
                                            size="icon"
                                            className="imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-rounded-xl"
                                            aria-label={__('Enviar')}
                                            title={__('Enviar (Enter)')}
                                            disabled={!canType || !draft.trim()}
                                            data-testid="imcrm-ai-send"
                                        >
                                            <Send className="imcrm-h-4 imcrm-w-4" />
                                        </Button>
                                    )}
                                </div>
                                <div className="imcrm-mt-1.5 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                                    {screen.listSlug && (
                                        <span
                                            className="imcrm-inline-flex imcrm-max-w-full imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-bg-muted imcrm-px-2 imcrm-py-0.5"
                                            data-testid="imcrm-ai-context"
                                            title={__('El asistente sabe qué tienes abierto')}
                                        >
                                            <span className="imcrm-truncate">
                                                {screen.recordId
                                                    ? sprintf(/* translators: 1: list slug, 2: record id */ __('Viendo «%1$s» · registro #%2$d'), screen.listSlug, screen.recordId)
                                                    : sprintf(/* translators: %s: list slug */ __('Viendo «%s»'), screen.listSlug)}
                                            </span>
                                        </span>
                                    )}
                                    <span>
                                        {__('Nada cambia hasta que apliques una tarjeta.')}
                                        <span className="imcrm-hidden [@media(hover:hover)]:imcrm-inline"> {__('Shift+Enter: otra línea.')}</span>
                                    </span>
                                </div>
                            </div>
                        </form>
                    </div>
                )}
            </div>
        </aside>
    );
}
