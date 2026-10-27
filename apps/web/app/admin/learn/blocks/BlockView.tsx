import { AlertTriangle, ArrowRight, ChevronDown, Info, Lightbulb, PlayCircle, Sparkles } from 'lucide-react';

import { RichLite } from '@/admin/help/RichLite';
import { help, useHasTour } from '@/admin/help/helpBus';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { DemoPlayer } from '../demos/DemoPlayer';
import { Illustration } from '../illustrations/registry';
import { LearnIcon, toneColor } from '../LearnIcon';
import type { LearnBlock } from '../content/types';

/**
 * Dibuja un bloque del manual. Todo es texto de React (sin innerHTML): el
 * formato sencillo lo resuelve `RichLite`, que sólo deja enlaces https,
 * mailto o a pantallas de la app.
 */

export function headingId(text: string): string {
    return (
        'h-' +
        text
            .toLowerCase()
            .normalize('NFD')
            .replace(/[̀-ͯ]/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '')
            .slice(0, 60)
    );
}

export interface BlockCtx {
    onNavigate: (path: string) => void;
    onOpenArticle: (id: string) => void;
    appName: string;
}

const fill = (s: string, app: string): string => s.replace(/\{app\}/g, app);

export function BlockView({ block, ctx }: { block: LearnBlock; ctx: BlockCtx }): JSX.Element | null {
    switch (block.t) {
        case 'p':
            return <RichLite text={fill(block.md, ctx.appName)} onInternalLink={ctx.onNavigate} className="imcrm-gap-3 imcrm-text-[15px] imcrm-leading-7 imcrm-text-foreground/90" />;
        case 'h':
            return (
                <h2 id={headingId(block.text)} className="imcrm-scroll-mt-20 imcrm-pt-4 imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">
                    {block.text}
                </h2>
            );
        case 'steps':
            return (
                <ol className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    {block.items.map((item, i) => (
                        <li key={i} className="imcrm-flex imcrm-gap-3">
                            <span className="imcrm-mt-0.5 imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary imcrm-text-xs imcrm-font-semibold imcrm-text-primary-foreground">
                                {i + 1}
                            </span>
                            <RichLite text={fill(item, ctx.appName)} onInternalLink={ctx.onNavigate} className="imcrm-min-w-0 imcrm-flex-1 imcrm-gap-2 imcrm-text-[15px] imcrm-leading-7" />
                        </li>
                    ))}
                </ol>
            );
        case 'settings':
            return (
                <section className="imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border" aria-label={block.title ?? __('Ajustes')}>
                    {block.title && (
                        <div className="imcrm-border-b imcrm-border-border imcrm-bg-muted/50 imcrm-px-4 imcrm-py-2.5 imcrm-text-sm imcrm-font-semibold">{block.title}</div>
                    )}
                    <div className="imcrm-hidden imcrm-grid-cols-[minmax(150px,0.8fr)_1.6fr] imcrm-border-b imcrm-border-border imcrm-bg-muted/30 imcrm-px-4 imcrm-py-2 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground sm:imcrm-grid">
                        <span>{__('Ajuste')}</span>
                        <span>{__('Qué hace')}</span>
                    </div>
                    <dl className="imcrm-divide-y imcrm-divide-border">
                        {block.rows.map((r) => (
                            <div key={r.name} className="imcrm-grid imcrm-gap-1 imcrm-px-4 imcrm-py-3 sm:imcrm-grid-cols-[minmax(150px,0.8fr)_1.6fr] sm:imcrm-gap-4">
                                <dt className="imcrm-text-sm imcrm-font-semibold">{r.name}</dt>
                                <dd className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-text-sm imcrm-leading-6 imcrm-text-foreground/85">
                                    <RichLite text={fill(r.what, ctx.appName)} onInternalLink={ctx.onNavigate} className="imcrm-gap-1.5 imcrm-text-sm" />
                                    {r.tip && (
                                        <span className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-[13px] imcrm-text-muted-foreground">
                                            <Lightbulb className="imcrm-mt-1 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-primary" aria-hidden />
                                            <RichLite text={fill(r.tip, ctx.appName)} onInternalLink={ctx.onNavigate} className="imcrm-gap-1 imcrm-text-[13px]" />
                                        </span>
                                    )}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </section>
            );
        case 'callout': {
            const look = {
                tip: { Icon: Lightbulb, box: 'imcrm-border-primary/25 imcrm-bg-primary/5', icon: 'imcrm-text-primary', label: __('Consejo') },
                warn: { Icon: AlertTriangle, box: 'imcrm-border-warning/30 imcrm-bg-warning/10', icon: 'imcrm-text-warning', label: __('Ojo') },
                info: { Icon: Info, box: 'imcrm-border-info/25 imcrm-bg-info/5', icon: 'imcrm-text-info', label: __('Bueno saber') },
            }[block.tone];
            return (
                <aside className={cn('imcrm-flex imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-px-4 imcrm-py-3.5', look.box)}>
                    <look.Icon className={cn('imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0', look.icon)} aria-hidden />
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1">
                        <span className="imcrm-text-sm imcrm-font-semibold">{block.title ?? look.label}</span>
                        <RichLite text={fill(block.md, ctx.appName)} onInternalLink={ctx.onNavigate} className="imcrm-gap-2 imcrm-text-sm imcrm-leading-6" />
                    </div>
                </aside>
            );
        }
        case 'example':
            return (
                <div className="imcrm-relative imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 imcrm-pl-5">
                    <span className="imcrm-absolute imcrm-inset-y-0 imcrm-left-0 imcrm-w-1 imcrm-bg-primary" aria-hidden />
                    <div className="imcrm-mb-1.5 imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-primary">
                        <Sparkles className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Ejemplo')}
                    </div>
                    <div className="imcrm-mb-1 imcrm-font-semibold">{block.title}</div>
                    <RichLite text={fill(block.md, ctx.appName)} onInternalLink={ctx.onNavigate} className="imcrm-gap-2 imcrm-text-sm imcrm-leading-6 imcrm-text-foreground/85" />
                </div>
            );
        case 'anim':
            return (
                <figure className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <Illustration name={block.key} />
                    {block.caption && <figcaption className="imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">{block.caption}</figcaption>}
                </figure>
            );
        case 'demo':
            return (
                <DemoPlayer
                    demoKey={block.key}
                    caption={block.caption}
                    fallback={
                        block.fallback ? (
                            <figure className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                                <Illustration name={block.fallback} />
                                {block.caption && <figcaption className="imcrm-text-center imcrm-text-xs imcrm-text-muted-foreground">{block.caption}</figcaption>}
                            </figure>
                        ) : null
                    }
                />
            );
        case 'cards':
            return (
                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                    {block.items.map((c) => (
                        <div key={c.title} className="imcrm-flex imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3.5">
                            {c.icon && (
                                <span
                                    className="imcrm-mt-0.5 imcrm-inline-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg"
                                    style={{ background: toneColor(c.tone ?? 'violet', 0.14), color: toneColor(c.tone ?? 'violet') }}
                                >
                                    <LearnIcon name={c.icon} className="imcrm-h-4 imcrm-w-4" />
                                </span>
                            )}
                            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1">
                                <span className="imcrm-text-sm imcrm-font-semibold">{c.title}</span>
                                <RichLite text={fill(c.md, ctx.appName)} onInternalLink={ctx.onNavigate} className="imcrm-gap-1.5 imcrm-text-[13px] imcrm-leading-5 imcrm-text-muted-foreground" />
                            </div>
                        </div>
                    ))}
                </div>
            );
        case 'faq':
            return (
                <div className="imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border">
                    {block.items.map((f) => (
                        <details key={f.q} className="imcrm-group">
                            <summary className="imcrm-flex imcrm-cursor-pointer imcrm-list-none imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-px-4 imcrm-py-3 imcrm-text-sm imcrm-font-medium hover:imcrm-bg-accent/50 [&::-webkit-details-marker]:imcrm-hidden">
                                {f.q}
                                <ChevronDown className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground imcrm-transition-transform group-open:imcrm-rotate-180" aria-hidden />
                            </summary>
                            <div className="imcrm-px-4 imcrm-pb-4">
                                <RichLite text={fill(f.a, ctx.appName)} onInternalLink={ctx.onNavigate} className="imcrm-gap-2 imcrm-text-sm imcrm-leading-6 imcrm-text-foreground/85" />
                            </div>
                        </details>
                    ))}
                </div>
            );
        case 'actions':
            return (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                    {block.items.map((a, i) => (
                        <ActionButton key={a.label} action={a} primary={i === 0} ctx={ctx} />
                    ))}
                </div>
            );
        case 'keys':
            return (
                <div className="imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border">
                    {block.items.map((k) => (
                        <div key={k.what} className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-4 imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-py-2.5 last:imcrm-border-b-0">
                            <span className="imcrm-text-sm">{k.what}</span>
                            <span className="imcrm-flex imcrm-shrink-0 imcrm-gap-1">
                                {k.keys.map((key) => (
                                    <kbd key={key} className="imcrm-min-w-6 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-center imcrm-font-mono imcrm-text-xs">
                                        {key}
                                    </kbd>
                                ))}
                            </span>
                        </div>
                    ))}
                </div>
            );
        default:
            return null;
    }
}

function ActionButton({
    action,
    primary,
    ctx,
}: {
    action: { label: string; to?: string; article?: string; tour?: string };
    primary: boolean;
    ctx: BlockCtx;
}): JSX.Element | null {
    const hasTour = useHasTour(action.tour ?? null);
    if (action.tour && !hasTour) return null;
    const onClick = (): void => {
        if (action.tour) help.startTour(action.tour);
        else if (action.article) ctx.onOpenArticle(action.article);
        else if (action.to) ctx.onNavigate(action.to);
    };
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'imcrm-inline-flex imcrm-h-9 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-lg imcrm-px-3.5 imcrm-text-sm imcrm-font-medium focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring',
                primary ? 'imcrm-bg-primary imcrm-text-primary-foreground hover:imcrm-bg-primary/90' : 'imcrm-border imcrm-border-border imcrm-bg-card hover:imcrm-bg-accent',
            )}
        >
            {action.tour && <PlayCircle className="imcrm-h-4 imcrm-w-4" aria-hidden />}
            {action.label}
            {!action.tour && <ArrowRight className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />}
        </button>
    );
}
