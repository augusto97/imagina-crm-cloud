import { memo, useState } from 'react';
import type { AiProposal } from '@imagina-base/shared';
import { Check, ChevronDown, CircleAlert, Copy, Loader2, Pencil, RotateCcw, Sparkles, X } from 'lucide-react';

import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { ChatMarkdown } from './ChatMarkdown';
import { ProposalCard } from './ProposalCard';

/** Un paso del asistente (una herramienta); `ok: null` = corriendo. */
export interface UiStep {
    name: string;
    label: string;
    ok: boolean | null;
    summary: string;
}

export interface UiMessage {
    id: string;
    role: 'user' | 'assistant';
    text: string;
    proposals: AiProposal[];
    steps: UiStep[];
    error: string | null;
    /** La respuesta todavía está llegando. */
    streaming?: boolean;
    at?: string;
}

interface Props {
    m: UiMessage;
    /** Es el último pedido o la última respuesta: se puede reintentar o editar. */
    last: boolean;
    busy: boolean;
    onRetry?: () => void;
    onEdit?: () => void;
    onApplied: (p: AiProposal) => void;
    onNavigate: () => void;
}

/**
 * v0.1.370 — Un mensaje del chat del asistente. El pedido de la persona va
 * en una burbuja; la respuesta, a todo el ancho con su formato (títulos,
 * listas, tablas), los pasos que dio y las tarjetas de propuesta.
 */
export const AssistantMessage = memo(function AssistantMessage({ m, last, busy, onRetry, onEdit, onApplied, onNavigate }: Props): JSX.Element {
    if (m.role === 'user') {
        return (
            <li className="imcrm-group imcrm-flex imcrm-flex-col imcrm-items-end imcrm-gap-1" data-role="user">
                <div className="imcrm-max-w-[85%] imcrm-whitespace-pre-wrap imcrm-break-words imcrm-rounded-2xl imcrm-rounded-br-md imcrm-bg-primary imcrm-px-3.5 imcrm-py-2 imcrm-text-sm imcrm-leading-relaxed imcrm-text-primary-foreground">
                    {m.text}
                </div>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-0.5 imcrm-opacity-100 imcrm-transition-opacity [@media(hover:hover)]:imcrm-opacity-0 [@media(hover:hover)]:group-hover:imcrm-opacity-100 [@media(hover:hover)]:group-focus-within:imcrm-opacity-100">
                    <CopyButton text={m.text} testId="imcrm-ai-copy-user" />
                    {last && onEdit && !busy && (
                        <ActionButton label={__('Editar el pedido')} onClick={onEdit} testId="imcrm-ai-edit">
                            <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                        </ActionButton>
                    )}
                </div>
            </li>
        );
    }

    const running = m.steps.find((s) => s.ok === null) ?? null;
    const thinking = Boolean(m.streaming) && !running && !m.text;
    const hasBody = m.text.trim().length > 0;
    const empty = !m.streaming && !hasBody && m.proposals.length === 0 && !m.error;

    return (
        <li className="imcrm-group imcrm-flex imcrm-gap-2.5" data-role="assistant">
            <span
                className="imcrm-mt-0.5 imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-primary"
                aria-hidden
            >
                <Sparkles className="imcrm-h-3.5 imcrm-w-3.5" />
            </span>
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-2.5">
                {m.steps.length > 0 && <StepsTrail steps={m.steps} running={running} />}
                {(hasBody || empty) && (
                    <div data-testid="imcrm-ai-text">
                        {hasBody ? <ChatMarkdown text={m.text} onNavigate={onNavigate} /> : <p className="imcrm-m-0 imcrm-text-sm imcrm-text-muted-foreground">…</p>}
                    </div>
                )}
                {m.proposals.map((p) => (
                    <ProposalCard key={p.id} proposal={p} onApplied={onApplied} />
                ))}
                {thinking && (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-ai-thinking">
                        <span className="imcrm-flex imcrm-gap-1" aria-hidden>
                            <span className="imcrm-h-1.5 imcrm-w-1.5 imcrm-animate-bounce imcrm-rounded-full imcrm-bg-primary/60 [animation-delay:-0.3s]" />
                            <span className="imcrm-h-1.5 imcrm-w-1.5 imcrm-animate-bounce imcrm-rounded-full imcrm-bg-primary/60 [animation-delay:-0.15s]" />
                            <span className="imcrm-h-1.5 imcrm-w-1.5 imcrm-animate-bounce imcrm-rounded-full imcrm-bg-primary/60" />
                        </span>
                        {__('Pensando…')}
                    </div>
                )}
                {m.error && (
                    <div
                        className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/10 imcrm-px-2.5 imcrm-py-2 imcrm-text-xs imcrm-text-destructive"
                        data-testid="imcrm-ai-error"
                    >
                        <CircleAlert className="imcrm-mt-px imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                        <span className="imcrm-min-w-0 imcrm-flex-1">{m.error}</span>
                        {last && onRetry && !busy && (
                            <button
                                type="button"
                                onClick={onRetry}
                                className="imcrm-shrink-0 imcrm-font-medium imcrm-underline-offset-2 hover:imcrm-underline"
                                data-testid="imcrm-ai-error-retry"
                            >
                                {__('Reintentar')}
                            </button>
                        )}
                    </div>
                )}
                {!m.streaming && (hasBody || m.proposals.length > 0) && (
                    <div className="imcrm-flex imcrm-items-center imcrm-gap-0.5 imcrm-opacity-100 imcrm-transition-opacity [@media(hover:hover)]:imcrm-opacity-0 [@media(hover:hover)]:group-hover:imcrm-opacity-100 [@media(hover:hover)]:group-focus-within:imcrm-opacity-100">
                        {hasBody && <CopyButton text={m.text} testId="imcrm-ai-copy" />}
                        {last && onRetry && !busy && (
                            <ActionButton label={__('Reintentar')} onClick={onRetry} testId="imcrm-ai-retry">
                                <RotateCcw className="imcrm-h-3.5 imcrm-w-3.5" />
                            </ActionButton>
                        )}
                    </div>
                )}
            </div>
        </li>
    );
});

function StepsTrail({ steps, running }: { steps: UiStep[]; running: UiStep | null }): JSX.Element {
    const [open, setOpen] = useState(false);
    const done = steps.filter((s) => s.ok !== null);
    const failed = done.filter((s) => s.ok === false).length;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="imcrm-ai-steps">
            {done.length > 0 && (
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    aria-expanded={open}
                    className="imcrm-inline-flex imcrm-w-fit imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-2.5 imcrm-py-0.5 imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-text-foreground"
                    data-testid="imcrm-ai-steps-toggle"
                >
                    <Check className="imcrm-h-3 imcrm-w-3 imcrm-text-success" />
                    {done.length === 1 ? __('1 paso') : sprintf(/* translators: %d: number of steps */ __('%d pasos'), done.length)}
                    {failed > 0 && (
                        <span className="imcrm-text-muted-foreground">
                            · {failed === 1 ? __('1 se corrigió') : sprintf(/* translators: %d: count */ __('%d se corrigieron'), failed)}
                        </span>
                    )}
                    <ChevronDown className={cn('imcrm-h-3 imcrm-w-3 imcrm-transition-transform', open && 'imcrm-rotate-180')} />
                </button>
            )}
            {open && (
                <ol
                    className="imcrm-m-0 imcrm-flex imcrm-list-none imcrm-flex-col imcrm-gap-1 imcrm-border-l imcrm-border-border imcrm-py-0.5 imcrm-pl-3"
                    data-testid="imcrm-ai-steps-list"
                >
                    {done.map((s, i) => (
                        <li key={i} className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs">
                            {s.ok ? (
                                <Check className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-success" />
                            ) : (
                                <X className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-destructive" />
                            )}
                            <span className="imcrm-min-w-0">
                                <span className="imcrm-text-foreground">{s.label}</span>
                                {s.summary && s.summary !== 'Listo' && <span className="imcrm-text-muted-foreground"> · {s.summary}</span>}
                            </span>
                        </li>
                    ))}
                </ol>
            )}
            {running && (
                <div className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-ai-working">
                    <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin imcrm-text-primary" /> {running.label}…
                </div>
            )}
        </div>
    );
}

function ActionButton({ label, onClick, testId, children }: { label: string; onClick: () => void; testId?: string; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            data-testid={testId}
            className="imcrm-inline-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground"
        >
            {children}
        </button>
    );
}

function CopyButton({ text, testId }: { text: string; testId?: string }): JSX.Element {
    const [copied, setCopied] = useState(false);
    return (
        <ActionButton
            label={copied ? __('Copiado') : __('Copiar')}
            testId={testId}
            onClick={() => {
                void navigator.clipboard.writeText(text).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                });
            }}
        >
            {copied ? <Check className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-success" /> : <Copy className="imcrm-h-3.5 imcrm-w-3.5" />}
        </ActionButton>
    );
}
