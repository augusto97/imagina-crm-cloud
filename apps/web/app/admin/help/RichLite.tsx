import { Fragment, useMemo, type ReactNode } from 'react';
import { markdownToRichDoc, type RichNode } from '@imagina-base/shared';

import { cn } from '@/lib/utils';

/**
 * Fase 7 — el «formato sencillo» de las guías (`**negrita**`, `1. pasos`,
 * `- viñetas`, `> consejo`, `[enlace](https://…)`) dibujado SIN `innerHTML`:
 * todo es texto de React, así una guía escrita por el operador no puede
 * inyectar nada. Los enlaces sólo pueden ser `https:`, `mailto:` o una
 * pantalla de la app (`/settings?s=miembros`), que se abre dentro de la app.
 */

export type InternalLinkHandler = (path: string) => void;

/** Qué hacer con un `href`: abrir afuera, navegar dentro, o dejarlo como texto. */
export function linkKind(href: unknown): 'external' | 'mail' | 'internal' | null {
    if (typeof href !== 'string') return null;
    const h = href.trim();
    if (/^https:\/\/[^\s]+$/i.test(h)) return 'external';
    if (/^mailto:[^\s@]+@[^\s@]+$/i.test(h)) return 'mail';
    if (/^\/[a-z0-9/_\-?=&%.]*$/i.test(h) && !h.startsWith('//')) return 'internal';
    return null;
}

function renderInline(nodes: RichNode[] | undefined, onInternal?: InternalLinkHandler): ReactNode[] {
    return (nodes ?? []).map((n, i) => {
        if (n.type === 'hardBreak') return <br key={i} />;
        if (n.type !== 'text') return <Fragment key={i}>{renderInline(n.content, onInternal)}</Fragment>;
        let el: ReactNode = n.text ?? '';
        const marks = n.marks ?? [];
        for (const m of marks) {
            if (m.type === 'bold') el = <strong className="imcrm-font-semibold imcrm-text-foreground">{el}</strong>;
            else if (m.type === 'italic') el = <em>{el}</em>;
            else if (m.type === 'strike') el = <s>{el}</s>;
        }
        const link = marks.find((m) => m.type === 'link');
        if (link) {
            const href = String(link.attrs?.href ?? '');
            const kind = linkKind(href);
            if (kind === 'external' || kind === 'mail') {
                el = (
                    <a
                        href={href}
                        target={kind === 'external' ? '_blank' : undefined}
                        rel="noopener noreferrer"
                        className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                    >
                        {el}
                    </a>
                );
            } else if (kind === 'internal' && onInternal) {
                el = (
                    <button
                        type="button"
                        onClick={() => onInternal(href)}
                        className="imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                    >
                        {el}
                    </button>
                );
            }
        }
        return <Fragment key={i}>{el}</Fragment>;
    });
}

function renderBlock(n: RichNode, key: number, onInternal?: InternalLinkHandler): ReactNode {
    switch (n.type) {
        case 'paragraph':
            return (
                <p key={key} className="imcrm-leading-relaxed">
                    {renderInline(n.content, onInternal)}
                </p>
            );
        case 'heading':
            return (
                <h4 key={key} className="imcrm-pt-1 imcrm-text-[13px] imcrm-font-semibold imcrm-text-foreground">
                    {renderInline(n.content, onInternal)}
                </h4>
            );
        case 'orderedList':
            return (
                <ol key={key} className="imcrm-flex imcrm-flex-col imcrm-gap-2" start={Number(n.attrs?.start ?? 1) || 1}>
                    {(n.content ?? []).map((li, k) => (
                        <li key={k} className="imcrm-flex imcrm-gap-2.5">
                            <span
                                aria-hidden
                                className="imcrm-mt-px imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-[11px] imcrm-font-semibold imcrm-text-primary"
                            >
                                {(Number(n.attrs?.start ?? 1) || 1) + k}
                            </span>
                            <div className="imcrm-min-w-0 imcrm-flex-1 imcrm-leading-relaxed">
                                {(li.content ?? []).map((c, j) =>
                                    c.type === 'paragraph' ? (
                                        <Fragment key={j}>{renderInline(c.content, onInternal)}</Fragment>
                                    ) : (
                                        renderBlock(c, j, onInternal)
                                    ),
                                )}
                            </div>
                        </li>
                    ))}
                </ol>
            );
        case 'bulletList':
            return (
                <ul key={key} className="imcrm-flex imcrm-list-disc imcrm-flex-col imcrm-gap-1 imcrm-pl-5">
                    {(n.content ?? []).map((li, k) => (
                        <li key={k} className="imcrm-leading-relaxed">
                            {(li.content ?? []).map((c, j) =>
                                c.type === 'paragraph' ? (
                                    <Fragment key={j}>{renderInline(c.content, onInternal)}</Fragment>
                                ) : (
                                    renderBlock(c, j, onInternal)
                                ),
                            )}
                        </li>
                    ))}
                </ul>
            );
        case 'blockquote':
            return (
                <blockquote
                    key={key}
                    className="imcrm-rounded-md imcrm-border-l-2 imcrm-border-primary/50 imcrm-bg-muted/50 imcrm-px-3 imcrm-py-2 imcrm-text-muted-foreground"
                >
                    {(n.content ?? []).map((c, j) => renderBlock(c, j, onInternal))}
                </blockquote>
            );
        case 'horizontalRule':
            return <hr key={key} className="imcrm-border-border" />;
        default:
            return n.content ? <Fragment key={key}>{n.content.map((c, j) => renderBlock(c, j, onInternal))}</Fragment> : null;
    }
}

export function RichLite({
    text,
    className,
    onInternalLink,
}: {
    text: string;
    className?: string;
    onInternalLink?: InternalLinkHandler;
}): JSX.Element {
    const doc = useMemo(() => markdownToRichDoc(text), [text]);
    return (
        <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-text-[13px] imcrm-text-foreground/90', className)}>
            {(doc.content ?? []).map((n, i) => renderBlock(n, i, onInternalLink))}
        </div>
    );
}

/** Una sola línea con `**negrita**` (los textos de los pasos del recorrido). */
export function InlineRich({ text }: { text: string }): JSX.Element {
    const nodes = useMemo(() => markdownToRichDoc(text).content?.[0]?.content, [text]);
    return <>{renderInline(nodes)}</>;
}
