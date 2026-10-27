import { Fragment, useMemo, type ReactNode } from 'react';
import { Link } from 'react-router';
import { isHttpsUrl, isSafeAppRoute, markdownToRichDoc, type RichNode } from '@imagina-base/shared';

import { cn } from '@/lib/utils';

/**
 * El cuerpo de una novedad: texto con formato sencillo (`**negrita**`,
 * `- viñeta`, `[enlace](https://…)`) dibujado con elementos de React. Nunca
 * HTML crudo: aunque el operador escriba `<script>`, sale como texto. Un
 * enlace sólo es enlace si va a una pantalla de la app o a un https.
 */
export function WhatsNewRichText({ text, className }: { text: string; className?: string }): JSX.Element | null {
    const doc = useMemo(() => markdownToRichDoc(text), [text]);
    if (text.trim() === '') return null;
    return (
        <div className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-text-[13px] imcrm-leading-relaxed imcrm-text-foreground/90', className)}>
            {(doc.content ?? []).map((n, i) => (
                <Block key={i} node={n} />
            ))}
        </div>
    );
}

function Block({ node }: { node: RichNode }): JSX.Element | null {
    switch (node.type) {
        case 'paragraph':
            return node.content?.length ? <p>{inline(node.content)}</p> : null;
        case 'heading':
            return <p className="imcrm-font-semibold imcrm-text-foreground">{inline(node.content)}</p>;
        case 'bulletList':
            return (
                <ul className="imcrm-flex imcrm-list-disc imcrm-flex-col imcrm-gap-1 imcrm-pl-5">
                    {(node.content ?? []).map((li, i) => (
                        <li key={i}>{(li.content ?? []).map((c, k) => (c.type === 'paragraph' ? <Fragment key={k}>{inline(c.content)}</Fragment> : <Block key={k} node={c} />))}</li>
                    ))}
                </ul>
            );
        case 'orderedList':
            return (
                <ol className="imcrm-flex imcrm-list-decimal imcrm-flex-col imcrm-gap-1 imcrm-pl-5" start={Number(node.attrs?.start ?? 1) || 1}>
                    {(node.content ?? []).map((li, i) => (
                        <li key={i}>{(li.content ?? []).map((c, k) => (c.type === 'paragraph' ? <Fragment key={k}>{inline(c.content)}</Fragment> : <Block key={k} node={c} />))}</li>
                    ))}
                </ol>
            );
        case 'blockquote':
            return (
                <blockquote className="imcrm-border-l-2 imcrm-border-border imcrm-pl-3 imcrm-text-muted-foreground">
                    {(node.content ?? []).map((c, i) => (
                        <Block key={i} node={c} />
                    ))}
                </blockquote>
            );
        case 'horizontalRule':
            return <hr className="imcrm-border-border" />;
        default:
            return node.content ? <p>{inline(node.content)}</p> : null;
    }
}

function inline(nodes: RichNode[] | undefined): ReactNode[] {
    return (nodes ?? []).map((n, i) => {
        if (n.type === 'hardBreak') return <br key={i} />;
        if (n.type !== 'text') return <Fragment key={i}>{inline(n.content)}</Fragment>;
        let out: ReactNode = n.text ?? '';
        const marks = n.marks ?? [];
        for (const m of marks) {
            if (m.type === 'bold') out = <strong className="imcrm-font-semibold imcrm-text-foreground">{out}</strong>;
            else if (m.type === 'italic') out = <em>{out}</em>;
            else if (m.type === 'strike') out = <s>{out}</s>;
        }
        const link = marks.find((m) => m.type === 'link');
        const href = typeof link?.attrs?.href === 'string' ? link.attrs.href : null;
        if (href && isSafeAppRoute(href)) {
            out = (
                <Link to={href} className="imcrm-font-medium imcrm-text-primary imcrm-underline-offset-2 hover:imcrm-underline">
                    {out}
                </Link>
            );
        } else if (href && isHttpsUrl(href)) {
            out = (
                <a href={href} target="_blank" rel="noopener noreferrer" className="imcrm-font-medium imcrm-text-primary imcrm-underline-offset-2 hover:imcrm-underline">
                    {out}
                </a>
            );
        }
        return <Fragment key={i}>{out}</Fragment>;
    });
}
