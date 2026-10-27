import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, BookOpen, ChevronRight, Lightbulb, Search, Sparkles, X } from 'lucide-react';

import { Illustration } from '@/admin/learn/illustrations/registry';
import { moduleById } from '@/admin/learn/content/registry';
import { LearnIcon, ToneSquare, toneColor } from '@/admin/learn/LearnIcon';
import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { IDEA_CATEGORIES, IDEAS, categoryMeta, ideaById, searchIdeas } from './catalog';
import { IdeaActivatePanel, appName } from './IdeaActivatePanel';
import { IdeaFlow } from './IdeaFlow';
import type { IdeaCategory, IdeaDef } from './types';

/**
 * Galería de ideas (v0.1.323, ADR-S76):
 *
 *   /ideas            portada: buscador, destacadas y todas las ideas por categoría
 *   /ideas/:ideaId    la idea: qué resuelve, cómo funciona y el panel «Actívala»
 *
 * Las ideas son datos (`catalog.ts`); esta pantalla sólo las muestra.
 */

const KIND_LABEL: Record<IdeaDef['plan']['kind'], string> = {
    automations: 'Automatización',
    list: 'Listas listas para usar',
    dashboard: 'Tablero',
    go: 'Configuración guiada',
};

function kindLabel(idea: IdeaDef): string {
    if (idea.plan.kind === 'automations' && idea.plan.automations.length > 1) return sprintf(__('%d automatizaciones'), idea.plan.automations.length);
    return __(KIND_LABEL[idea.plan.kind]);
}

export function IdeasPage(): JSX.Element {
    const { ideaId } = useParams();
    const idea = ideaId ? ideaById(ideaId) : undefined;
    if (ideaId && !idea) return <NotFound />;
    return idea ? <IdeaDetail key={idea.id} idea={idea} /> : <Gallery />;
}

// ── Portada ─────────────────────────────────────────────────────────────────

function Gallery(): JSX.Element {
    const [params, setParams] = useSearchParams();
    const [query, setQuery] = useState('');
    const cat = (params.get('c') as IdeaCategory | null) ?? null;
    useEffect(() => {
        document.title = __('Ideas para tu negocio');
    }, []);
    const found = useMemo(() => searchIdeas(query).filter((i) => cat === null || i.category === cat), [query, cat]);
    const featured = IDEAS.filter((i) => i.featured);
    const searching = query.trim().length > 1 || cat !== null;
    const setCat = (c: IdeaCategory | null): void => {
        const next = new URLSearchParams(params);
        if (c) next.set('c', c);
        else next.delete('c');
        setParams(next, { replace: true });
    };

    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-max-w-6xl imcrm-flex-col imcrm-gap-8 imcrm-px-4 imcrm-py-6 sm:imcrm-px-8 sm:imcrm-py-8" data-testid="ideas-gallery" data-tour="ideas-gallery">
            <section
                className="imcrm-relative imcrm-overflow-hidden imcrm-rounded-2xl imcrm-border imcrm-border-border imcrm-px-5 imcrm-py-8 sm:imcrm-px-10 sm:imcrm-py-10"
                style={{ background: `radial-gradient(90% 120% at 0% 0%, ${toneColor('amber', 0.18)}, transparent 60%), radial-gradient(80% 120% at 100% 100%, hsl(var(--imcrm-primary) / .14), transparent 60%), hsl(var(--imcrm-card))` }}
            >
                <div className="imcrm-grid imcrm-items-center imcrm-gap-8 lg:imcrm-grid-cols-[1.1fr_1fr]">
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                        <span className="imcrm-inline-flex imcrm-w-fit imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-bg-amber-500/15 imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-semibold imcrm-text-amber-700 dark:imcrm-text-amber-300">
                            <Lightbulb className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {sprintf(__('%d ideas'), IDEAS.length)}
                        </span>
                        <h1 className="imcrm-text-3xl imcrm-font-bold imcrm-tracking-tight sm:imcrm-text-4xl">{__('Ideas para tu negocio')}</h1>
                        <p className="imcrm-max-w-xl imcrm-text-base imcrm-leading-7 imcrm-text-muted-foreground">
                            {__('Cosas que otras empresas ya resolvieron con la app: recordatorios de pago, avisos por WhatsApp, agendas, tableros… Elige una, mira cómo funciona y actívala sobre tus listas con un clic.')}
                        </p>
                        <label className="imcrm-flex imcrm-h-12 imcrm-items-center imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-4 imcrm-shadow-sm focus-within:imcrm-ring-2 focus-within:imcrm-ring-ring">
                            <Search className="imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                            <input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={__('Busca: «cobrar», «WhatsApp», «citas», «stock»…')}
                                aria-label={__('Buscar ideas')}
                                className="imcrm-min-w-0 imcrm-flex-1 imcrm-border-0 imcrm-bg-transparent imcrm-text-base imcrm-outline-none placeholder:imcrm-text-muted-foreground"
                                data-testid="ideas-search"
                            />
                            {query && (
                                <button type="button" onClick={() => setQuery('')} aria-label={__('Limpiar')} className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent">
                                    <X className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                </button>
                            )}
                        </label>
                    </div>
                    <div className="imcrm-hidden imcrm-w-full imcrm-max-w-[520px] lg:imcrm-block lg:imcrm-justify-self-end">
                        <Illustration name="auto-flujo" />
                    </div>
                </div>
            </section>

            <nav className="imcrm-flex imcrm-gap-2 imcrm-overflow-x-auto imcrm-overflow-y-hidden imcrm-pb-1" aria-label={__('Categorías')}>
                <CatChip active={cat === null} onClick={() => setCat(null)} label={__('Todas')} count={IDEAS.length} />
                {IDEA_CATEGORIES.map((c) => (
                    <CatChip key={c.id} active={cat === c.id} onClick={() => setCat(c.id)} label={__(c.label)} icon={c.icon} tone={c.tone} count={IDEAS.filter((i) => i.category === c.id).length} />
                ))}
            </nav>

            {searching ? (
                <section className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                    <p className="imcrm-text-sm imcrm-text-muted-foreground" data-testid="ideas-count">
                        {found.length === 0 ? __('No encontramos ideas con esas palabras. Prueba con otras.') : sprintf(__('%d ideas'), found.length)}
                    </p>
                    <div className="imcrm-grid imcrm-gap-4 sm:imcrm-grid-cols-2 xl:imcrm-grid-cols-3">
                        {found.map((i) => (
                            <IdeaCard key={i.id} idea={i} />
                        ))}
                    </div>
                </section>
            ) : (
                <>
                    <section className="imcrm-flex imcrm-flex-col imcrm-gap-4" aria-labelledby="ideas-featured">
                        <div>
                            <h2 id="ideas-featured" className="imcrm-text-lg imcrm-font-semibold">
                                {__('Recomendadas')}
                            </h2>
                            <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Si no sabes por dónde empezar, empieza por estas.')}</p>
                        </div>
                        <div className="imcrm-grid imcrm-gap-4 sm:imcrm-grid-cols-2 xl:imcrm-grid-cols-3">
                            {featured.map((i) => (
                                <IdeaCard key={i.id} idea={i} />
                            ))}
                        </div>
                    </section>
                    {IDEA_CATEGORIES.map((c) => {
                        const list = IDEAS.filter((i) => i.category === c.id && !i.featured);
                        if (list.length === 0) return null;
                        return (
                            <section key={c.id} className="imcrm-flex imcrm-flex-col imcrm-gap-4" aria-labelledby={`ideas-c-${c.id}`}>
                                <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                                    <ToneSquare icon={c.icon} tone={c.tone} size={32} />
                                    <div>
                                        <h2 id={`ideas-c-${c.id}`} className="imcrm-text-lg imcrm-font-semibold">
                                            {__(c.label)}
                                        </h2>
                                        <p className="imcrm-text-sm imcrm-text-muted-foreground">{__(c.description)}</p>
                                    </div>
                                </div>
                                <div className="imcrm-grid imcrm-gap-4 sm:imcrm-grid-cols-2 xl:imcrm-grid-cols-3">
                                    {list.map((i) => (
                                        <IdeaCard key={i.id} idea={i} />
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                </>
            )}
        </div>
    );
}

function CatChip({ active, onClick, label, icon, tone, count }: { active: boolean; onClick: () => void; label: string; icon?: string; tone?: string; count: number }): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={cn(
                'imcrm-inline-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-border imcrm-px-3 imcrm-py-1.5 imcrm-text-sm imcrm-font-medium imcrm-transition-colors',
                active ? 'imcrm-border-primary imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-border-border imcrm-bg-card hover:imcrm-bg-accent',
            )}
        >
            {icon && (
                <span style={{ color: active ? undefined : toneColor(tone ?? 'violet') }}>
                    <LearnIcon name={icon} className="imcrm-h-4 imcrm-w-4" />
                </span>
            )}
            {label}
            <span className={cn('imcrm-text-xs', active ? 'imcrm-opacity-80' : 'imcrm-text-muted-foreground')}>{count}</span>
        </button>
    );
}

function IdeaCard({ idea }: { idea: IdeaDef }): JSX.Element {
    const cat = categoryMeta(idea.category);
    return (
        <Link
            to={`/ideas/${idea.id}`}
            className="imcrm-group imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-2xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-transition-shadow hover:imcrm-border-primary/40 hover:imcrm-shadow-imcrm-lg"
            data-testid={`idea-card-${idea.id}`}
        >
            <div className="imcrm-pointer-events-none imcrm-p-2 imcrm-pb-0">
                <Illustration name={idea.illustration} />
            </div>
            <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-2 imcrm-p-4">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs imcrm-text-muted-foreground">
                    <ToneSquare icon={idea.icon} tone={idea.tone} size={22} />
                    <span>{cat ? __(cat.label) : ''}</span>
                    <span aria-hidden>·</span>
                    <span>{kindLabel(idea)}</span>
                </span>
                <span className="imcrm-font-semibold imcrm-leading-snug">{idea.title}</span>
                <span className="imcrm-text-[13px] imcrm-leading-5 imcrm-text-muted-foreground">{idea.summary}</span>
                <div className="imcrm-mt-auto imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-pt-2">
                    {(idea.needsApps ?? []).slice(0, 4).map((k) => (
                        <span key={k} title={appName(k)}>
                            <IntegrationLogo integrationKey={k} size={18} />
                        </span>
                    ))}
                    <span className="imcrm-ml-auto imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary">
                        {idea.plan.kind === 'go' ? __('Ver cómo') : __('Activar')}
                        <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5 imcrm-transition-transform group-hover:imcrm-translate-x-0.5" aria-hidden />
                    </span>
                </div>
            </div>
        </Link>
    );
}

// ── La idea ─────────────────────────────────────────────────────────────────

function IdeaDetail({ idea }: { idea: IdeaDef }): JSX.Element {
    const cat = categoryMeta(idea.category);
    const plan = idea.plan;
    const learn = useMemo(() => {
        if (!idea.learn) return null;
        const [m, a] = idea.learn.split('/');
        const mod = moduleById(m ?? '');
        const art = mod?.articles.find((x) => x.id === a);
        return mod && art ? { mod, art } : null;
    }, [idea.learn]);
    const related = IDEAS.filter((i) => i.category === idea.category && i.id !== idea.id).slice(0, 3);
    // En el celular el panel queda al final: un botón fijo lleva a él mientras no se ve.
    const panelRef = useRef<HTMLElement | null>(null);
    const [panelVisible, setPanelVisible] = useState(true);
    useEffect(() => {
        const el = panelRef.current;
        if (!el || typeof IntersectionObserver === 'undefined') return;
        const io = new IntersectionObserver(([e]) => setPanelVisible(Boolean(e?.isIntersecting)), { threshold: 0.05 });
        io.observe(el);
        return () => io.disconnect();
    }, []);
    useEffect(() => {
        document.title = idea.title;
        window.scrollTo?.({ top: 0 });
    }, [idea.title]);

    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-max-w-6xl imcrm-flex-col imcrm-gap-6 imcrm-px-4 imcrm-py-6 sm:imcrm-px-8" data-testid="idea-detail">
            <nav className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-text-muted-foreground" aria-label={__('Ruta')}>
                <Link to="/ideas" className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 hover:imcrm-text-foreground">
                    <ArrowLeft className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    {__('Ideas')}
                </Link>
                {cat && (
                    <>
                        <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        <Link to={`/ideas?c=${cat.id}`} className="hover:imcrm-text-foreground">
                            {__(cat.label)}
                        </Link>
                    </>
                )}
            </nav>

            <div className="imcrm-grid imcrm-items-start imcrm-gap-8 lg:imcrm-grid-cols-[minmax(0,1fr)_400px]">
                <article className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-6">
                    <header className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                        <span className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                            <ToneSquare icon={idea.icon} tone={idea.tone} size={30} />
                            {kindLabel(idea)}
                        </span>
                        <h1 className="imcrm-text-2xl imcrm-font-bold imcrm-tracking-tight sm:imcrm-text-3xl">{idea.title}</h1>
                        <p className="imcrm-text-base imcrm-leading-7 imcrm-text-muted-foreground">{idea.summary}</p>
                    </header>

                    <div className="imcrm-overflow-hidden imcrm-rounded-2xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2">
                        <Illustration name={idea.illustration} />
                    </div>

                    <section className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-xl imcrm-border-l-4 imcrm-bg-muted/40 imcrm-p-4" style={{ borderLeftColor: toneColor(idea.tone) }}>
                        <h2 className="imcrm-text-sm imcrm-font-semibold">{__('Lo que resuelve')}</h2>
                        <p className="imcrm-text-sm imcrm-leading-6">{idea.problem}</p>
                    </section>

                    <section className="imcrm-flex imcrm-flex-col imcrm-gap-3" aria-labelledby="idea-how">
                        <h2 id="idea-how" className="imcrm-text-lg imcrm-font-semibold">
                            {__('Cómo funciona')}
                        </h2>
                        <ol className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                            {idea.steps.map((s, i) => (
                                <li key={i} className="imcrm-flex imcrm-items-start imcrm-gap-3">
                                    <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-text-xs imcrm-font-bold imcrm-text-white" style={{ background: toneColor(idea.tone) }}>
                                        {i + 1}
                                    </span>
                                    <span className="imcrm-pt-0.5 imcrm-text-sm imcrm-leading-6">{s}</span>
                                </li>
                            ))}
                        </ol>
                    </section>

                    <section className="imcrm-flex imcrm-flex-col imcrm-gap-3" aria-labelledby="idea-creates">
                        <h2 id="idea-creates" className="imcrm-text-lg imcrm-font-semibold">
                            {__('Qué se crea')}
                        </h2>
                        {plan.kind === 'automations' ? (
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                                {plan.automations.map((a) => (
                                    <div key={a.name} className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3">
                                        <span className="imcrm-text-sm imcrm-font-medium">{a.name}</span>
                                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{a.description}</span>
                                        <IdeaFlow idea={{ ...idea, plan: { ...plan, automations: [a] } }} />
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3">
                                <IdeaFlow idea={idea} />
                            </div>
                        )}
                    </section>

                    {learn && (
                        <Link
                            to={`/aprende/${learn.mod.id}/${learn.art.id}`}
                            className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 hover:imcrm-bg-accent/50"
                            data-testid="idea-learn"
                        >
                            <ToneSquare icon={learn.mod.icon} tone={learn.mod.tone} size={34} />
                            <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground">
                                    <BookOpen className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                    {__('Aprende más en el centro de aprendizaje')}
                                </span>
                                <span className="imcrm-font-medium">{learn.art.title}</span>
                            </span>
                            <ChevronRight className="imcrm-ml-auto imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                        </Link>
                    )}
                </article>

                <aside ref={panelRef} id="idea-activar" className="imcrm-flex imcrm-scroll-mt-4 imcrm-flex-col imcrm-gap-4 lg:imcrm-sticky lg:imcrm-top-4">
                    <IdeaActivatePanel idea={idea} />
                </aside>
            </div>

            {!panelVisible && (
                <button
                    type="button"
                    onClick={() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className="imcrm-fixed imcrm-bottom-4 imcrm-left-1/2 imcrm-z-30 imcrm-inline-flex imcrm--translate-x-1/2 imcrm-items-center imcrm-gap-2 imcrm-rounded-full imcrm-bg-primary imcrm-px-5 imcrm-py-3 imcrm-text-sm imcrm-font-semibold imcrm-text-primary-foreground imcrm-shadow-imcrm-lg lg:imcrm-hidden"
                    data-testid="idea-jump-activate"
                >
                    <Sparkles className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    {idea.plan.kind === 'go' ? __('Ponla en marcha') : __('Actívala')}
                </button>
            )}

            {related.length > 0 && (
                <section className="imcrm-flex imcrm-flex-col imcrm-gap-4 imcrm-border-t imcrm-border-border imcrm-pt-6">
                    <h2 className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-lg imcrm-font-semibold">
                        <Sparkles className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                        {__('Otras ideas parecidas')}
                    </h2>
                    <div className="imcrm-grid imcrm-gap-4 sm:imcrm-grid-cols-2 xl:imcrm-grid-cols-3">
                        {related.map((i) => (
                            <IdeaCard key={i.id} idea={i} />
                        ))}
                    </div>
                </section>
            )}
        </div>
    );
}

function NotFound(): JSX.Element {
    const navigate = useNavigate();
    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-max-w-md imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-px-4 imcrm-py-16 imcrm-text-center">
            <Lightbulb className="imcrm-h-8 imcrm-w-8 imcrm-text-muted-foreground" aria-hidden />
            <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Esta idea ya no existe.')}</p>
            <button type="button" onClick={() => navigate('/ideas')} className="imcrm-text-sm imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                {__('Ver todas las ideas')}
            </button>
        </div>
    );
}
