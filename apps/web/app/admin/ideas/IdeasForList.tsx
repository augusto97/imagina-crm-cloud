import { useMemo } from 'react';
import { Link } from 'react-router';
import { ChevronRight, Lightbulb } from 'lucide-react';

import { fieldFitsRole } from '@/admin/templates/roleMapping';
import { ToneSquare } from '@/admin/learn/LearnIcon';
import { __ } from '@/lib/i18n';
import type { FieldEntity } from '@/types/field';
import type { ListSummary } from '@/types/list';

import { fold } from './activate';
import { IDEAS } from './catalog';
import type { IdeaDef } from './types';

/**
 * «Ideas para esta lista» (v0.1.323): las ideas de automatizaciones cuyos
 * campos obligatorios ESTA lista ya tiene (por tipo), primero las que se
 * parecen por nombre. Así la pantalla de automatizaciones sugiere algo
 * concreto en vez de un editor en blanco.
 */
export function ideasThatFit(list: Pick<ListSummary, 'name' | 'slug'>, fields: readonly Pick<FieldEntity, 'id' | 'slug' | 'label' | 'type'>[], ideas: readonly IdeaDef[] = IDEAS): IdeaDef[] {
    const name = fold(`${list.name} ${list.slug}`);
    const scored: Array<{ idea: IdeaDef; score: number }> = [];
    for (const idea of ideas) {
        if (idea.plan.kind !== 'automations') continue;
        const fits = idea.plan.roles.filter((r) => r.required).every((r) => fields.some((f) => fieldFitsRole(f, r)));
        if (!fits) continue;
        const named = (idea.listHints ?? []).some((h) => name.includes(fold(h)));
        scored.push({ idea, score: (named ? 10 : 0) + (idea.featured ? 2 : 0) + idea.plan.roles.filter((r) => r.required).length });
    }
    return scored.sort((a, b) => b.score - a.score).map((s) => s.idea);
}

export function IdeasForList({ list, fields, max = 3 }: { list: ListSummary; fields: FieldEntity[]; max?: number }): JSX.Element | null {
    const ideas = useMemo(() => ideasThatFit(list, fields).slice(0, max), [list, fields, max]);
    if (ideas.length === 0) return null;
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="ideas-for-list" data-tour="automations-ideas">
            <div className="imcrm-flex imcrm-items-end imcrm-justify-between imcrm-gap-3">
                <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-semibold">
                    <Lightbulb className="imcrm-h-4 imcrm-w-4 imcrm-text-amber-500" aria-hidden />
                    {__('Ideas para esta lista')}
                </h2>
                <Link to="/ideas" className="imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                    {__('Ver todas las ideas')}
                </Link>
            </div>
            <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-3">
                {ideas.map((i) => (
                    <Link
                        key={i.id}
                        to={`/ideas/${i.id}?lista=${encodeURIComponent(list.slug)}`}
                        className="imcrm-group imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3 hover:imcrm-border-primary/40 hover:imcrm-shadow-sm"
                    >
                        <ToneSquare icon={i.icon} tone={i.tone} size={30} />
                        <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-0.5">
                            <span className="imcrm-text-sm imcrm-font-medium imcrm-leading-snug">{i.title}</span>
                            <span className="imcrm-line-clamp-2 imcrm-text-xs imcrm-text-muted-foreground">{i.summary}</span>
                        </span>
                        <ChevronRight className="imcrm-mt-1 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground group-hover:imcrm-text-primary" aria-hidden />
                    </Link>
                ))}
            </div>
        </section>
    );
}
