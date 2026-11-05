import { memo, useMemo, useState, type ReactNode } from 'react';
import { Check, CheckSquare2, Copy, Square } from 'lucide-react';
import { Link } from 'react-router';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { chatLinkKind, parseChatMarkdown, type Block, type Inline } from './chatMarkdown';

/**
 * v0.1.370 — Dibuja la respuesta del asistente con su formato (títulos,
 * listas, tablas, código con «Copiar», enlaces). Todo es texto de React: el
 * contenido del modelo nunca llega como HTML. Un enlace a una pantalla de la
 * app navega dentro de la app; los de afuera abren en otra pestaña.
 */
export const ChatMarkdown = memo(function ChatMarkdown({ text, onNavigate }: { text: string; onNavigate?: () => void }): JSX.Element {
    const blocks = useMemo(() => parseChatMarkdown(text), [text]);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-text-sm imcrm-leading-relaxed imcrm-text-foreground [overflow-wrap:anywhere]" data-testid="imcrm-ai-markdown">
            {blocks.map((b, i) => (
                <BlockView key={i} b={b} onNavigate={onNavigate} />
            ))}
        </div>
    );
});

function BlockView({ b, onNavigate }: { b: Block; onNavigate?: () => void }): JSX.Element {
    switch (b.t) {
        case 'p':
            return <p className="imcrm-m-0">{renderInline(b.c, onNavigate)}</p>;
        case 'h': {
            const cls =
                b.level === 1
                    ? 'imcrm-text-base imcrm-font-semibold'
                    : b.level === 2
                      ? 'imcrm-text-[15px] imcrm-font-semibold'
                      : 'imcrm-text-sm imcrm-font-semibold';
            const Tag = (`h${b.level + 2}` as 'h3' | 'h4' | 'h5');
            return <Tag className={cn('imcrm-m-0 imcrm-mt-1 imcrm-text-foreground', cls)}>{renderInline(b.c, onNavigate)}</Tag>;
        }
        case 'hr':
            return <hr className="imcrm-my-1 imcrm-border-border" />;
        case 'quote':
            return (
                <blockquote className="imcrm-m-0 imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-l-2 imcrm-border-primary/50 imcrm-pl-3 imcrm-text-muted-foreground">
                    {b.c.map((x, i) => (
                        <BlockView key={i} b={x} onNavigate={onNavigate} />
                    ))}
                </blockquote>
            );
        case 'code':
            return <CodeBlock lang={b.lang} code={b.v} />;
        case 'list':
            return <ListView b={b} onNavigate={onNavigate} />;
        case 'table':
            return (
                <div className="imcrm-max-w-full imcrm-overflow-x-auto imcrm-rounded-lg imcrm-border imcrm-border-border" data-testid="imcrm-ai-md-table">
                    <table className="imcrm-w-full imcrm-border-collapse imcrm-text-[13px]">
                        <thead className="imcrm-bg-muted/60">
                            <tr>
                                {b.head.map((h, k) => (
                                    <th
                                        key={k}
                                        className="imcrm-whitespace-nowrap imcrm-border-b imcrm-border-border imcrm-px-2.5 imcrm-py-1.5 imcrm-font-semibold"
                                        style={{ textAlign: b.align[k] ?? 'left' }}
                                    >
                                        {renderInline(h, onNavigate)}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {b.rows.map((r, ri) => (
                                <tr key={ri} className="imcrm-border-b imcrm-border-border last:imcrm-border-0 even:imcrm-bg-muted/20">
                                    {r.map((c, k) => (
                                        <td key={k} className="imcrm-px-2.5 imcrm-py-1.5 imcrm-align-top" style={{ textAlign: b.align[k] ?? 'left' }}>
                                            {renderInline(c, onNavigate)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            );
    }
}

function ListView({ b, onNavigate }: { b: Extract<Block, { t: 'list' }>; onNavigate?: () => void }): JSX.Element {
    const isTasks = b.items.every((it) => it.task !== null);
    const items = b.items.map((it, i) => (
        <li key={i} className={cn('imcrm-pl-0.5', isTasks && 'imcrm-flex imcrm-list-none imcrm-gap-1.5')}>
            {it.task !== null && (
                <span className={cn('imcrm-mt-[3px] imcrm-shrink-0', it.task ? 'imcrm-text-primary' : 'imcrm-text-muted-foreground')} aria-label={it.task ? __('Hecho') : __('Pendiente')}>
                    {it.task ? <CheckSquare2 className="imcrm-h-3.5 imcrm-w-3.5" /> : <Square className="imcrm-h-3.5 imcrm-w-3.5" />}
                </span>
            )}
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1.5">
                <span className={cn(it.task === true && 'imcrm-text-muted-foreground imcrm-line-through')}>{renderInline(it.c, onNavigate)}</span>
                {it.sub.map((s, k) => (
                    <BlockView key={k} b={s} onNavigate={onNavigate} />
                ))}
            </div>
        </li>
    ));
    const cls = cn('imcrm-m-0 imcrm-flex imcrm-flex-col imcrm-gap-1', isTasks ? 'imcrm-pl-0' : 'imcrm-pl-5', b.ordered ? 'imcrm-list-decimal' : !isTasks && 'imcrm-list-disc', 'marker:imcrm-text-muted-foreground');
    return b.ordered ? (
        <ol className={cls} start={b.start}>
            {items}
        </ol>
    ) : (
        <ul className={cls}>{items}</ul>
    );
}

function CodeBlock({ lang, code }: { lang: string; code: string }): JSX.Element {
    const [copied, setCopied] = useState(false);
    const copy = (): void => {
        void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        });
    };
    return (
        <div className="imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/50" data-testid="imcrm-ai-md-code">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-border-b imcrm-border-border imcrm-px-2.5 imcrm-py-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                <span className="imcrm-font-mono">{lang || __('código')}</span>
                <button
                    type="button"
                    onClick={copy}
                    className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-px-1.5 imcrm-py-0.5 hover:imcrm-bg-background hover:imcrm-text-foreground"
                    data-testid="imcrm-ai-md-code-copy"
                >
                    {copied ? <Check className="imcrm-h-3 imcrm-w-3" /> : <Copy className="imcrm-h-3 imcrm-w-3" />}
                    {copied ? __('Copiado') : __('Copiar')}
                </button>
            </div>
            <pre className="imcrm-m-0 imcrm-max-h-80 imcrm-overflow-auto imcrm-p-2.5 imcrm-text-[12px] imcrm-leading-snug">
                <code className="imcrm-font-mono [overflow-wrap:normal]">{code}</code>
            </pre>
        </div>
    );
}

function renderInline(nodes: Inline[], onNavigate?: () => void): ReactNode[] {
    return nodes.map((n, i) => {
        switch (n.t) {
            case 'text':
                return n.v;
            case 'br':
                return <br key={i} />;
            case 'code':
                return (
                    <code key={i} className="imcrm-rounded imcrm-bg-muted imcrm-px-1 imcrm-py-0.5 imcrm-font-mono imcrm-text-[0.88em]">
                        {n.v}
                    </code>
                );
            case 'strong':
                return (
                    <strong key={i} className="imcrm-font-semibold">
                        {renderInline(n.c, onNavigate)}
                    </strong>
                );
            case 'em':
                return <em key={i}>{renderInline(n.c, onNavigate)}</em>;
            case 'del':
                return <s key={i}>{renderInline(n.c, onNavigate)}</s>;
            case 'link': {
                const kind = chatLinkKind(n.href);
                const inner = renderInline(n.c, onNavigate);
                const cls = 'imcrm-font-medium imcrm-text-primary imcrm-underline-offset-2 hover:imcrm-underline';
                if (kind === 'internal') {
                    return (
                        <Link key={i} to={n.href.replace(/^#/, '')} className={cls} onClick={onNavigate}>
                            {inner}
                        </Link>
                    );
                }
                if (kind) {
                    return (
                        <a key={i} href={n.href} className={cls} target={kind === 'external' ? '_blank' : undefined} rel="noopener noreferrer">
                            {inner}
                        </a>
                    );
                }
                return <span key={i}>{inner}</span>;
            }
        }
    });
}
