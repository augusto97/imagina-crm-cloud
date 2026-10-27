import { Link } from 'react-router';
import { Check, GraduationCap, Lightbulb } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { LEARN_GROUPS, type LearnArticleMeta, type LearnModuleMeta } from './content/types';
import { LEARN_MODULES } from './content/registry';
import { ToneSquare } from './LearnIcon';
import { useLearnProgress } from './useLearnProgress';
import { useLearnVisibility } from './useLearnVisibility';

// ── Índice lateral ───────────────────────────────────────────────────────

export function LearnNav({
    current,
    currentArticle,
    visible,
    ideasActive = false,
}: {
    current?: string;
    currentArticle?: string;
    visible: (m: LearnModuleMeta, a?: LearnArticleMeta) => boolean;
    /** v0.1.323 — la galería de ideas vive en la misma sección del riel. */
    ideasActive?: boolean;
}): JSX.Element {
    const { isRead } = useLearnProgress();
    return (
        <nav aria-label={__('Temas del centro de aprendizaje')} className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-pb-8">
            <Link
                to="/aprende"
                className={cn(
                    'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-px-2 imcrm-py-1.5 imcrm-text-sm imcrm-font-semibold hover:imcrm-bg-accent',
                    !current && !ideasActive && 'imcrm-bg-accent',
                )}
                data-testid="learn-nav-home"
            >
                <GraduationCap className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                {__('Centro de aprendizaje')}
            </Link>
            <Link
                to="/ideas"
                className={cn(
                    '-imcrm-mt-3 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-px-2 imcrm-py-1.5 imcrm-text-sm imcrm-font-semibold hover:imcrm-bg-accent',
                    ideasActive && 'imcrm-bg-accent',
                )}
                data-testid="learn-nav-ideas"
                data-tour="learn-ideas-link"
            >
                <Lightbulb className="imcrm-h-4 imcrm-w-4 imcrm-text-amber-500" aria-hidden />
                {__('Ideas para tu negocio')}
            </Link>
            {LEARN_GROUPS.map((g) => {
                const mods = LEARN_MODULES.filter((m) => m.group === g.id && visible(m));
                if (mods.length === 0) return null;
                return (
                    <div key={g.id} className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                        <div className="imcrm-px-2 imcrm-pb-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__(g.label)}</div>
                        {mods.map((m) => {
                            const open = m.id === current;
                            const arts = m.articles.filter((a) => visible(m, a));
                            const done = arts.filter((a) => isRead(a.id)).length;
                            return (
                                <div key={m.id}>
                                    <Link
                                        to={`/aprende/${m.id}`}
                                        className={cn(
                                            'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-px-2 imcrm-py-1.5 imcrm-text-[13px] hover:imcrm-bg-accent',
                                            open && !currentArticle && 'imcrm-bg-accent imcrm-font-medium',
                                            open && 'imcrm-font-medium',
                                        )}
                                        data-testid={`learn-nav-${m.id}`}
                                    >
                                        <ToneSquare icon={m.icon} tone={m.tone} size={20} />
                                        <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{m.title}</span>
                                        {done === arts.length && arts.length > 0 && <Check className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-success" aria-label={__('Leído')} />}
                                    </Link>
                                    {open && (
                                        <ul className="imcrm-my-1 imcrm-ml-[18px] imcrm-flex imcrm-flex-col imcrm-border-l imcrm-border-border imcrm-pl-2">
                                            {arts.map((a) => (
                                                <li key={a.id}>
                                                    <Link
                                                        to={`/aprende/${m.id}/${a.id}`}
                                                        className={cn(
                                                            'imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-text-[12.5px] imcrm-leading-snug imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground',
                                                            a.id === currentArticle && 'imcrm-bg-primary/10 imcrm-font-medium imcrm-text-primary hover:imcrm-bg-primary/10 hover:imcrm-text-primary',
                                                        )}
                                                        aria-current={a.id === currentArticle ? 'page' : undefined}
                                                    >
                                                        <span className="imcrm-min-w-0 imcrm-flex-1">{a.title}</span>
                                                        {isRead(a.id) && <Check className="imcrm-mt-0.5 imcrm-h-3 imcrm-w-3 imcrm-shrink-0 imcrm-text-success" aria-label={__('Leído')} />}
                                                    </Link>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </nav>
    );
}


/** El índice del manual dentro del panel lateral de la app (sección «Aprende» del riel). */
export default function LearnPanelNav({ pathname }: { pathname: string }): JSX.Element {
    const visible = useLearnVisibility();
    if (pathname.startsWith('/ideas')) return <LearnNav visible={visible} ideasActive />;
    const [, , moduleId, articleId] = pathname.split('/');
    return <LearnNav current={moduleId} currentArticle={articleId} visible={visible} />;
}
