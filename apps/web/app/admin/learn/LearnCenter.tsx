import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Clock, GraduationCap, Lightbulb, Lock, Menu, Megaphone, PlayCircle, Search, ShieldAlert, Sparkles, X } from 'lucide-react';

import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useHelpViewer } from '@/admin/help/useHelpData';
import { TourGallery } from '@/admin/help/tours/TourGallery';
import { help } from '@/admin/help/helpBus';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { __, sprintf } from '@/lib/i18n';
import { currentAppName } from '@/lib/pwa/appMeta';
import { cn } from '@/lib/utils';

import { BlockView, headingId, type BlockCtx } from './blocks/BlockView';
import { LEARN_GROUPS, fold, type LearnArticle, type LearnArticleMeta, type LearnModuleMeta } from './content/types';
import { LEARN_MODULES, loadAllContent, loadModuleContent, moduleById, searchManual, type LearnHit } from './content/registry';
import { Illustration } from './illustrations/registry';
import { ToneSquare, toneColor } from './LearnIcon';
import { markArticleRead, useLearnProgress } from './useLearnProgress';
import { LearnNav } from './LearnNav';
import { useLearnVisibility } from './useLearnVisibility';

/**
 * Centro de aprendizaje (v0.1.322, ADR-S75): el manual completo de la app,
 * por módulo, con ilustraciones animadas y capturas reales paso a paso.
 *
 *   /aprende                       portada: buscador, por dónde empezar y todos los módulos
 *   /aprende/:modulo               portada del módulo y sus artículos
 *   /aprende/:modulo/:articulo     el artículo, con su índice «En esta página»
 */

const LEVEL_LABEL: Record<string, string> = { basic: 'Básico', intermediate: 'Intermedio', advanced: 'Avanzado' };

export function LearnCenter(): JSX.Element {
    const { moduleId, articleId } = useParams();
    const navigate = useNavigate();
    const isDesktop = useMediaQuery('(min-width: 1024px)');
    const [navOpen, setNavOpen] = useState(false);
    const visible = useLearnVisibility();
    const module = moduleId ? moduleById(moduleId) : undefined;

    useEffect(() => setNavOpen(false), [moduleId, articleId]);

    const nav = <LearnNav current={module?.id} currentArticle={articleId} visible={visible} />;

    return (
        <div className="imcrm-flex imcrm-min-h-full imcrm-gap-0" data-testid="learn-center">
            <div className="imcrm-min-w-0 imcrm-flex-1">
                {!isDesktop && (
                    <div className="imcrm-sticky imcrm-top-0 imcrm-z-10 imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-bg-background/95 imcrm-px-3 imcrm-py-2 imcrm-backdrop-blur">
                        <button
                            type="button"
                            onClick={() => setNavOpen(true)}
                            className="imcrm-inline-flex imcrm-h-9 imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-3 imcrm-text-sm imcrm-font-medium"
                            data-testid="learn-nav-open"
                        >
                            <Menu className="imcrm-h-4 imcrm-w-4" aria-hidden />
                            {__('Temas')}
                        </button>
                        <span className="imcrm-min-w-0 imcrm-truncate imcrm-text-sm imcrm-text-muted-foreground">{module ? module.title : __('Centro de aprendizaje')}</span>
                    </div>
                )}
                {!module && moduleId ? (
                    <NotFound onBack={() => navigate('/aprende')} />
                ) : module && articleId ? (
                    <ArticlePage key={articleId} module={module} articleId={articleId} visible={visible} />
                ) : module ? (
                    <ModulePage module={module} visible={visible} />
                ) : (
                    <Home visible={visible} />
                )}
            </div>
            {!isDesktop && (
                <Sheet open={navOpen} onOpenChange={setNavOpen}>
                    <SheetContent side="left" className="imcrm-w-[min(320px,88vw)] imcrm-overflow-y-auto imcrm-p-3">
                        <SheetTitle className="imcrm-sr-only">{__('Temas del centro de aprendizaje')}</SheetTitle>
                        {nav}
                    </SheetContent>
                </Sheet>
            )}
        </div>
    );
}

// ── Buscador ─────────────────────────────────────────────────────────────

function LearnSearch({ visible, autoFocus, big }: { visible: (m: LearnModuleMeta, a?: LearnArticleMeta) => boolean; autoFocus?: boolean; big?: boolean }): JSX.Element {
    const [q, setQ] = useState('');
    const [bodies, setBodies] = useState<Map<string, LearnArticle> | null>(null);
    const navigate = useNavigate();
    useEffect(() => {
        if (q.trim().length > 1 && !bodies) void loadAllContent().then(setBodies);
    }, [q, bodies]);
    const hits: LearnHit[] = useMemo(() => (q.trim().length > 1 ? searchManual(q, bodies, visible) : []), [q, bodies, visible]);
    return (
        <div className="imcrm-relative">
            <label className={cn('imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-sm focus-within:imcrm-ring-2 focus-within:imcrm-ring-ring', big ? 'imcrm-h-12 imcrm-px-4' : 'imcrm-h-10 imcrm-px-3')}>
                <Search className={cn('imcrm-shrink-0 imcrm-text-muted-foreground', big ? 'imcrm-h-5 imcrm-w-5' : 'imcrm-h-4 imcrm-w-4')} aria-hidden />
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    autoFocus={autoFocus}
                    placeholder={__('Busca: «enviar WhatsApp», «permisos», «importar Excel»…')}
                    aria-label={__('Buscar en el centro de aprendizaje')}
                    className={cn('imcrm-min-w-0 imcrm-flex-1 imcrm-border-0 imcrm-bg-transparent imcrm-outline-none placeholder:imcrm-text-muted-foreground', big ? 'imcrm-text-base' : 'imcrm-text-sm')}
                    data-testid="learn-search"
                />
                {q && (
                    <button type="button" onClick={() => setQ('')} aria-label={__('Limpiar')} className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent">
                        <X className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </button>
                )}
            </label>
            {q.trim().length > 1 && (
                <div className="imcrm-absolute imcrm-left-0 imcrm-right-0 imcrm-top-full imcrm-z-30 imcrm-mt-2 imcrm-max-h-[60vh] imcrm-overflow-y-auto imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-popover imcrm-p-1.5 imcrm-shadow-imcrm-lg" data-testid="learn-search-results">
                    {hits.length === 0 ? (
                        <p className="imcrm-px-3 imcrm-py-4 imcrm-text-sm imcrm-text-muted-foreground">{bodies ? __('No encontramos nada con esas palabras. Prueba con otras.') : __('Buscando…')}</p>
                    ) : (
                        hits.map((h) => (
                            <button
                                key={h.article.id}
                                type="button"
                                onClick={() => navigate(`/aprende/${h.module.id}/${h.article.id}`)}
                                className="imcrm-flex imcrm-w-full imcrm-items-start imcrm-gap-3 imcrm-rounded-lg imcrm-px-2.5 imcrm-py-2 imcrm-text-left hover:imcrm-bg-accent"
                            >
                                <ToneSquare icon={h.module.icon} tone={h.module.tone} size={26} />
                                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-0.5">
                                    <span className="imcrm-text-sm imcrm-font-medium">{h.article.title}</span>
                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{h.snippet ?? h.article.summary}</span>
                                    <span className="imcrm-text-[11px] imcrm-text-muted-foreground/80">{h.module.title}</span>
                                </span>
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}

// ── Portada ──────────────────────────────────────────────────────────────

function Home({ visible }: { visible: (m: LearnModuleMeta, a?: LearnArticleMeta) => boolean }): JSX.Element {
    const { read } = useLearnProgress();
    const mods = LEARN_MODULES.filter((m) => visible(m));
    const total = mods.reduce((n, m) => n + m.articles.filter((a) => visible(m, a)).length, 0);
    const done = mods.reduce((n, m) => n + m.articles.filter((a) => visible(m, a) && read.has(a.id)).length, 0);
    const start = mods.find((m) => m.group === 'start');
    useEffect(() => {
        document.title = __('Centro de aprendizaje');
    }, []);
    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-max-w-6xl imcrm-flex-col imcrm-gap-10 imcrm-px-4 imcrm-py-6 sm:imcrm-px-8 sm:imcrm-py-8">
            <section
                className="imcrm-relative imcrm-overflow-visible imcrm-rounded-2xl imcrm-border imcrm-border-border imcrm-px-5 imcrm-py-8 sm:imcrm-px-10 sm:imcrm-py-10"
                style={{ background: `radial-gradient(90% 120% at 0% 0%, hsl(var(--imcrm-primary) / .16), transparent 60%), radial-gradient(80% 120% at 100% 100%, ${toneColor('violet', 0.14)}, transparent 60%), hsl(var(--imcrm-card))` }}
            >
                <div className="imcrm-grid imcrm-items-center imcrm-gap-8 lg:imcrm-grid-cols-[1.1fr_1fr]">
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                        <span className="imcrm-inline-flex imcrm-w-fit imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-bg-primary/12 imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-semibold imcrm-text-primary">
                            <GraduationCap className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {__('Centro de aprendizaje')}
                        </span>
                        <h1 className="imcrm-text-3xl imcrm-font-bold imcrm-tracking-tight sm:imcrm-text-4xl">{__('Aprende a sacarle todo el provecho')}</h1>
                        <p className="imcrm-max-w-xl imcrm-text-base imcrm-leading-7 imcrm-text-muted-foreground">
                            {__('Guías completas de cada parte de la app, con animaciones y capturas paso a paso: qué hace cada ajuste, para qué sirve y cómo lo usan otras empresas.')}
                        </p>
                        <LearnSearch visible={visible} big />
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-4 imcrm-gap-y-2 imcrm-text-xs imcrm-text-muted-foreground">
                            <span>{sprintf(__('%1$d módulos · %2$d guías'), mods.length, total)}</span>
                            {done > 0 && (
                                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-success">
                                    <Check className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                    {sprintf(__('Llevas %d leídas'), done)}
                                </span>
                            )}
                        </div>
                    </div>
                    <div className="imcrm-hidden imcrm-w-full imcrm-max-w-[520px] lg:imcrm-block lg:imcrm-justify-self-end">
                        <Illustration name="learn-hero" />
                    </div>
                </div>
            </section>

            <Link
                to="/ideas"
                className="imcrm-group imcrm-grid imcrm-items-center imcrm-gap-4 imcrm-overflow-hidden imcrm-rounded-2xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 hover:imcrm-border-primary/40 hover:imcrm-shadow-imcrm-lg sm:imcrm-grid-cols-[1fr_260px] sm:imcrm-p-6"
                style={{ background: `radial-gradient(70% 140% at 0% 0%, ${toneColor('amber', 0.16)}, transparent 60%), hsl(var(--imcrm-card))` }}
                data-testid="learn-ideas-banner"
            >
                <span className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                    <span className="imcrm-inline-flex imcrm-w-fit imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-bg-amber-500/15 imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-semibold imcrm-text-amber-700 dark:imcrm-text-amber-300">
                        <Lightbulb className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Ideas para tu negocio')}
                    </span>
                    <span className="imcrm-text-lg imcrm-font-semibold">{__('¿No sabes qué automatizar? Mira lo que otras empresas ya hacen')}</span>
                    <span className="imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Recordatorios de pago, avisos por WhatsApp, agendas, tableros de ventas y más: cada idea se activa sobre tus listas con un clic.')}
                    </span>
                    <span className="imcrm-mt-1 imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-sm imcrm-font-medium imcrm-text-primary">
                        {__('Ver las ideas')}
                        <ArrowRight className="imcrm-h-4 imcrm-w-4 imcrm-transition-transform group-hover:imcrm-translate-x-0.5" aria-hidden />
                    </span>
                </span>
                <span className="imcrm-pointer-events-none imcrm-hidden sm:imcrm-block">
                    <Illustration name="cobro-automatizar" />
                </span>
            </Link>

            <TourGallery />

            {start && (
                <section className="imcrm-flex imcrm-flex-col imcrm-gap-4" aria-labelledby="learn-start">
                    <div className="imcrm-flex imcrm-items-end imcrm-justify-between imcrm-gap-3">
                        <div>
                            <h2 id="learn-start" className="imcrm-text-lg imcrm-font-semibold">
                                {__('Empieza aquí')}
                            </h2>
                            <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Si es tu primera vez, estas guías te dejan andando en minutos.')}</p>
                        </div>
                        <div className="imcrm-flex imcrm-gap-2">
                            <button
                                type="button"
                                onClick={() => help.startTour('welcome')}
                                className="imcrm-hidden imcrm-h-9 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-3 imcrm-text-sm imcrm-font-medium hover:imcrm-bg-accent sm:imcrm-inline-flex"
                            >
                                <PlayCircle className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                                {__('Recorrido por la app')}
                            </button>
                        </div>
                    </div>
                    <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-4">
                        {start.articles
                            .filter((a) => visible(start, a))
                            .slice(0, 4)
                            .map((a, i) => (
                                <Link
                                    key={a.id}
                                    to={`/aprende/${start.id}/${a.id}`}
                                    className="imcrm-group imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 hover:imcrm-border-primary/40 hover:imcrm-shadow-sm"
                                >
                                    <span className="imcrm-flex imcrm-items-center imcrm-justify-between">
                                        <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary imcrm-text-xs imcrm-font-bold imcrm-text-primary-foreground">
                                            {i + 1}
                                        </span>
                                        {read.has(a.id) && <Check className="imcrm-h-4 imcrm-w-4 imcrm-text-success" aria-label={__('Leído')} />}
                                    </span>
                                    <span className="imcrm-font-semibold imcrm-leading-snug">{a.title}</span>
                                    <span className="imcrm-text-[13px] imcrm-leading-5 imcrm-text-muted-foreground">{a.summary}</span>
                                    <span className="imcrm-mt-auto imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-pt-1 imcrm-text-xs imcrm-text-muted-foreground">
                                        <Clock className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                        {sprintf(__('%d min'), a.minutes)}
                                    </span>
                                </Link>
                            ))}
                    </div>
                </section>
            )}

            {LEARN_GROUPS.filter((g) => g.id !== 'start').map((g) => {
                const list = mods.filter((m) => m.group === g.id);
                if (list.length === 0) return null;
                return (
                    <section key={g.id} className="imcrm-flex imcrm-flex-col imcrm-gap-4" aria-labelledby={`learn-g-${g.id}`}>
                        <div>
                            <h2 id={`learn-g-${g.id}`} className="imcrm-text-lg imcrm-font-semibold">
                                {__(g.label)}
                            </h2>
                            <p className="imcrm-text-sm imcrm-text-muted-foreground">{__(g.blurb)}</p>
                        </div>
                        <div className="imcrm-grid imcrm-gap-4 sm:imcrm-grid-cols-2 xl:imcrm-grid-cols-3">
                            {list.map((m) => (
                                <ModuleCard key={m.id} module={m} visible={visible} />
                            ))}
                        </div>
                    </section>
                );
            })}

            <section className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                <Link to="/novedades" className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 hover:imcrm-bg-accent/50">
                    <ToneSquare icon="Sparkles" tone="amber" size={36} />
                    <span className="imcrm-flex imcrm-flex-col">
                        <span className="imcrm-font-semibold">{__('Novedades')}</span>
                        <span className="imcrm-text-sm imcrm-text-muted-foreground">{__('Lo último que llegó a la app.')}</span>
                    </span>
                    <ChevronRight className="imcrm-ml-auto imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                </Link>
                <button type="button" onClick={() => help.openHelp()} className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 imcrm-text-left hover:imcrm-bg-accent/50">
                    <ToneSquare icon="BookOpen" tone="blue" size={36} />
                    <span className="imcrm-flex imcrm-flex-col">
                        <span className="imcrm-font-semibold">{__('Respuestas rápidas')}</span>
                        <span className="imcrm-text-sm imcrm-text-muted-foreground">{__('Las guías cortas del panel de Ayuda y el contacto de soporte.')}</span>
                    </span>
                    <ChevronRight className="imcrm-ml-auto imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                </button>
            </section>
        </div>
    );
}

function ModuleCard({ module: m, visible }: { module: LearnModuleMeta; visible: (m: LearnModuleMeta, a?: LearnArticleMeta) => boolean }): JSX.Element {
    const { isRead } = useLearnProgress();
    const arts = m.articles.filter((a) => visible(m, a));
    const done = arts.filter((a) => isRead(a.id)).length;
    return (
        <Link
            to={`/aprende/${m.id}`}
            className="imcrm-group imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-2xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-transition-shadow hover:imcrm-border-primary/40 hover:imcrm-shadow-imcrm-lg"
            data-testid={`learn-card-${m.id}`}
        >
            <div className="imcrm-pointer-events-none imcrm-p-2 imcrm-pb-0">
                <Illustration name={m.hero} />
            </div>
            <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1.5 imcrm-p-4">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <ToneSquare icon={m.icon} tone={m.tone} size={24} />
                    <span className="imcrm-font-semibold">{m.title}</span>
                </span>
                <span className="imcrm-text-[13px] imcrm-leading-5 imcrm-text-muted-foreground">{m.tagline}</span>
                <span className="imcrm-mt-auto imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-pt-2 imcrm-text-xs imcrm-text-muted-foreground">
                    <BookOpen className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {sprintf(__('%d guías'), arts.length)}
                    {done > 0 && (
                        <span className="imcrm-ml-auto imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-success">
                            <Check className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {done}/{arts.length}
                        </span>
                    )}
                </span>
            </div>
        </Link>
    );
}

// ── Módulo ───────────────────────────────────────────────────────────────

function ModulePage({ module: m, visible }: { module: LearnModuleMeta; visible: (m: LearnModuleMeta, a?: LearnArticleMeta) => boolean }): JSX.Element {
    const { isRead } = useLearnProgress();
    const arts = m.articles.filter((a) => visible(m, a));
    useEffect(() => {
        document.title = m.title;
        void loadModuleContent(m.id);
    }, [m]);
    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-max-w-5xl imcrm-flex-col imcrm-gap-8 imcrm-px-4 imcrm-py-6 sm:imcrm-px-8 sm:imcrm-py-8" data-testid="learn-module">
            <Breadcrumb items={[{ label: __('Aprende'), to: '/aprende' }, { label: m.title }]} />
            <section className="imcrm-grid imcrm-items-center imcrm-gap-8 lg:imcrm-grid-cols-[1fr_1.05fr]">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                    <ToneSquare icon={m.icon} tone={m.tone} size={44} />
                    <h1 className="imcrm-text-3xl imcrm-font-bold imcrm-tracking-tight">{m.title}</h1>
                    <p className="imcrm-text-base imcrm-leading-7 imcrm-text-muted-foreground">{m.tagline}</p>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                        {m.highlights.map((h) => (
                            <li key={h} className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                                <span className="imcrm-mt-0.5 imcrm-flex imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full" style={{ background: toneColor(m.tone, 0.16), color: toneColor(m.tone) }}>
                                    <Check className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                </span>
                                {h}
                            </li>
                        ))}
                    </ul>
                    {arts[0] && (
                        <Link
                            to={`/aprende/${m.id}/${arts[0].id}`}
                            className="imcrm-mt-1 imcrm-inline-flex imcrm-h-10 imcrm-w-fit imcrm-items-center imcrm-gap-2 imcrm-rounded-lg imcrm-bg-primary imcrm-px-4 imcrm-text-sm imcrm-font-semibold imcrm-text-primary-foreground hover:imcrm-bg-primary/90"
                            data-testid="learn-module-start"
                        >
                            {__('Empezar')}
                            <ArrowRight className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        </Link>
                    )}
                </div>
                <Illustration name={m.hero} />
            </section>
            <section className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                <h2 className="imcrm-text-lg imcrm-font-semibold">{sprintf(__('%d guías en este módulo'), arts.length)}</h2>
                <ol className="imcrm-grid imcrm-gap-3 md:imcrm-grid-cols-2">
                    {arts.map((a, i) => (
                        <li key={a.id}>
                            <Link
                                to={`/aprende/${m.id}/${a.id}`}
                                className="imcrm-flex imcrm-h-full imcrm-items-start imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 hover:imcrm-border-primary/40 hover:imcrm-shadow-sm"
                                data-testid={`learn-article-link-${a.id}`}
                            >
                                <span
                                    className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-text-xs imcrm-font-bold"
                                    style={isRead(a.id) ? { background: 'hsl(var(--imcrm-success) / .15)', color: 'hsl(var(--imcrm-success))' } : { background: toneColor(m.tone, 0.14), color: toneColor(m.tone) }}
                                >
                                    {isRead(a.id) ? <Check className="imcrm-h-3.5 imcrm-w-3.5" aria-label={__('Leído')} /> : i + 1}
                                </span>
                                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1">
                                    <span className="imcrm-font-semibold imcrm-leading-snug">{a.title}</span>
                                    <span className="imcrm-text-[13px] imcrm-leading-5 imcrm-text-muted-foreground">{a.summary}</span>
                                    <span className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1 imcrm-pt-1 imcrm-text-xs imcrm-text-muted-foreground">
                                        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                                            <Clock className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                            {sprintf(__('%d min'), a.minutes)}
                                        </span>
                                        {a.level && <span>{__(LEVEL_LABEL[a.level] ?? '')}</span>}
                                        {a.needs && (
                                            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                                                <Lock className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                                {__('Administración')}
                                            </span>
                                        )}
                                    </span>
                                </span>
                            </Link>
                        </li>
                    ))}
                </ol>
            </section>
        </div>
    );
}

// ── Artículo ─────────────────────────────────────────────────────────────

function ArticlePage({ module: m, articleId, visible }: { module: LearnModuleMeta; articleId: string; visible: (m: LearnModuleMeta, a?: LearnArticleMeta) => boolean }): JSX.Element {
    const navigate = useNavigate();
    const viewer = useHelpViewer();
    const [content, setContent] = useState<LearnArticle[] | null>(null);
    const meta = m.articles.find((a) => a.id === articleId);
    const arts = m.articles.filter((a) => visible(m, a));
    const index = arts.findIndex((a) => a.id === articleId);
    const article = content?.find((a) => a.id === articleId) ?? null;
    const titleRef = useRef<HTMLHeadingElement | null>(null);

    useEffect(() => {
        let alive = true;
        void loadModuleContent(m.id).then((c) => alive && setContent(c));
        return () => {
            alive = false;
        };
    }, [m.id]);

    useEffect(() => {
        if (meta) document.title = meta.title;
        document.querySelector('main')?.scrollTo({ top: 0 });
        titleRef.current?.focus({ preventScroll: true });
    }, [meta]);

    // Leído = llegó al final (o se quedó un rato).
    const endRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!article) return;
        const t = window.setTimeout(() => markArticleRead(articleId), 45_000);
        const el = endRef.current;
        const io =
            el && typeof IntersectionObserver !== 'undefined'
                ? new IntersectionObserver(([e]) => {
                      if (e?.isIntersecting) markArticleRead(articleId);
                  })
                : null;
        if (el) io?.observe(el);
        return () => {
            window.clearTimeout(t);
            io?.disconnect();
        };
    }, [article, articleId]);

    if (!meta || !visible(m, meta)) return <NotFound onBack={() => navigate(`/aprende/${m.id}`)} />;

    const ctx: BlockCtx = {
        onNavigate: (path) => navigate(path),
        onOpenArticle: (id) => {
            const target = LEARN_MODULES.find((mod) => mod.articles.some((a) => a.id === id));
            if (target) navigate(`/aprende/${target.id}/${id}`);
        },
        appName: currentAppName(),
    };
    const headings = (article?.blocks ?? []).filter((b): b is { t: 'h'; text: string } => b.t === 'h');
    const restricted = meta.needs ? !viewer.caps.has(meta.needs) : false;
    const prev = index > 0 ? arts[index - 1] : null;
    const next = index >= 0 && index < arts.length - 1 ? arts[index + 1] : null;
    const related = (article?.related ?? [])
        .map((id) => {
            const mod = LEARN_MODULES.find((x) => x.articles.some((a) => a.id === id));
            const a = mod?.articles.find((x) => x.id === id);
            return mod && a && visible(mod, a) ? { mod, a } : null;
        })
        .filter((x): x is { mod: LearnModuleMeta; a: LearnArticleMeta } => x !== null);

    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-max-w-6xl imcrm-gap-10 imcrm-px-4 imcrm-py-6 sm:imcrm-px-8 sm:imcrm-py-8" data-testid="learn-article" data-article={articleId}>
            <article className="imcrm-flex imcrm-min-w-0 imcrm-max-w-[760px] imcrm-flex-1 imcrm-flex-col imcrm-gap-5">
                <Breadcrumb items={[{ label: __('Aprende'), to: '/aprende' }, { label: m.title, to: `/aprende/${m.id}` }, { label: meta.title }]} />
                <header className="imcrm-flex imcrm-flex-col imcrm-gap-3">
                    <h1 ref={titleRef} tabIndex={-1} className="imcrm-text-3xl imcrm-font-bold imcrm-tracking-tight focus:imcrm-outline-none" data-testid="learn-article-title">
                        {meta.title}
                    </h1>
                    <p className="imcrm-text-lg imcrm-leading-7 imcrm-text-muted-foreground">{meta.summary}</p>
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-4 imcrm-gap-y-1 imcrm-text-xs imcrm-text-muted-foreground">
                        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                            <Clock className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {sprintf(__('%d min de lectura'), meta.minutes)}
                        </span>
                        {meta.level && <span>{__(LEVEL_LABEL[meta.level] ?? '')}</span>}
                        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5">
                            <ToneSquare icon={m.icon} tone={m.tone} size={16} />
                            {m.title}
                        </span>
                    </div>
                </header>

                {restricted && (
                    <p className="imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-rounded-xl imcrm-border imcrm-border-warning/30 imcrm-bg-warning/10 imcrm-px-4 imcrm-py-3 imcrm-text-sm imcrm-leading-6" data-testid="learn-restricted">
                        <ShieldAlert className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-warning" aria-hidden />
                        {__('Esto lo hace quien administra la empresa. Puedes leerlo para saber qué se puede hacer y pedírselo a esa persona.')}
                    </p>
                )}

                {!article ? (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-3" aria-busy>
                        {[100, 92, 96, 70].map((w) => (
                            <div key={w} className="imcrm-h-4 imcrm-animate-pulse imcrm-rounded imcrm-bg-muted" style={{ width: `${w}%` }} />
                        ))}
                    </div>
                ) : (
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-5" data-testid="learn-article-body">
                        {article.blocks.map((b, i) => (
                            <BlockView key={i} block={b} ctx={ctx} />
                        ))}
                    </div>
                )}

                <div ref={endRef} />

                {related.length > 0 && (
                    <section className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-6" aria-label={__('También te puede servir')}>
                        <h2 className="imcrm-text-sm imcrm-font-semibold">{__('También te puede servir')}</h2>
                        <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2">
                            {related.map(({ mod, a }) => (
                                <Link key={a.id} to={`/aprende/${mod.id}/${a.id}`} className="imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-3 imcrm-py-2.5 hover:imcrm-bg-accent/50">
                                    <ToneSquare icon={mod.icon} tone={mod.tone} size={22} />
                                    <span className="imcrm-min-w-0 imcrm-text-sm">{a.title}</span>
                                </Link>
                            ))}
                        </div>
                    </section>
                )}

                <nav className="imcrm-grid imcrm-gap-3 imcrm-border-t imcrm-border-border imcrm-pt-6 sm:imcrm-grid-cols-2" aria-label={__('Más guías de este módulo')}>
                    {prev ? (
                        <Link to={`/aprende/${m.id}/${prev.id}`} className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-p-3.5 hover:imcrm-bg-accent/50" data-testid="learn-prev">
                            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground">
                                <ArrowLeft className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                {__('Anterior')}
                            </span>
                            <span className="imcrm-text-sm imcrm-font-medium">{prev.title}</span>
                        </Link>
                    ) : (
                        <span />
                    )}
                    {next ? (
                        <Link to={`/aprende/${m.id}/${next.id}`} className="imcrm-flex imcrm-flex-col imcrm-items-end imcrm-gap-1 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-p-3.5 imcrm-text-right hover:imcrm-bg-accent/50" data-testid="learn-next">
                            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Siguiente')}
                                <ArrowRight className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            </span>
                            <span className="imcrm-text-sm imcrm-font-medium">{next.title}</span>
                        </Link>
                    ) : (
                        <Link to="/aprende" className="imcrm-flex imcrm-flex-col imcrm-items-end imcrm-gap-1 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-p-3.5 imcrm-text-right hover:imcrm-bg-accent/50">
                            <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground">
                                <Sparkles className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                {__('Terminaste este módulo')}
                            </span>
                            <span className="imcrm-text-sm imcrm-font-medium">{__('Ver otros módulos')}</span>
                        </Link>
                    )}
                </nav>
            </article>

            {headings.length > 1 && (
                <aside className="imcrm-sticky imcrm-top-6 imcrm-hidden imcrm-h-fit imcrm-w-52 imcrm-shrink-0 xl:imcrm-block" aria-label={__('En esta página')}>
                    <OnThisPage headings={headings.map((h) => h.text)} />
                </aside>
            )}
        </div>
    );
}

function OnThisPage({ headings }: { headings: string[] }): JSX.Element {
    const [active, setActive] = useState<string | null>(null);
    useEffect(() => {
        if (typeof IntersectionObserver === 'undefined') return;
        const els = headings.map((h) => document.getElementById(headingId(h))).filter((e): e is HTMLElement => e !== null);
        const io = new IntersectionObserver(
            (entries) => {
                const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
                if (vis[0]) setActive(vis[0].target.id);
            },
            { rootMargin: '0px 0px -70% 0px' },
        );
        els.forEach((e) => io.observe(e));
        return () => io.disconnect();
    }, [headings]);
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
            <span className="imcrm-mb-1 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('En esta página')}</span>
            {headings.map((h) => {
                const id = headingId(h);
                return (
                    <a
                        key={id}
                        href={`#${id}`}
                        onClick={(e) => {
                            e.preventDefault();
                            document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        }}
                        className={cn(
                            'imcrm-border-l-2 imcrm-py-1 imcrm-pl-3 imcrm-text-[13px] imcrm-leading-snug hover:imcrm-text-foreground',
                            active === id ? 'imcrm-border-primary imcrm-font-medium imcrm-text-foreground' : 'imcrm-border-border imcrm-text-muted-foreground',
                        )}
                    >
                        {h}
                    </a>
                );
            })}
        </div>
    );
}

function Breadcrumb({ items }: { items: Array<{ label: string; to?: string }> }): JSX.Element {
    return (
        <nav aria-label={__('Ruta')} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground">
            {items.map((it, i) => (
                <span key={`${it.label}-${i}`} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                    {i > 0 && <ChevronRight className="imcrm-h-3 imcrm-w-3" aria-hidden />}
                    {it.to ? (
                        <Link to={it.to} className="hover:imcrm-text-foreground hover:imcrm-underline">
                            {it.label}
                        </Link>
                    ) : (
                        <span className="imcrm-text-foreground">{it.label}</span>
                    )}
                </span>
            ))}
        </nav>
    );
}

function NotFound({ onBack }: { onBack: () => void }): JSX.Element {
    return (
        <div className="imcrm-mx-auto imcrm-flex imcrm-max-w-md imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-px-4 imcrm-py-16 imcrm-text-center">
            <Megaphone className="imcrm-h-8 imcrm-w-8 imcrm-text-muted-foreground" aria-hidden />
            <p className="imcrm-font-semibold">{__('Esa guía no existe (o ya no está).')}</p>
            <button type="button" onClick={onBack} className="imcrm-text-sm imcrm-font-medium imcrm-text-primary hover:imcrm-underline">
                {__('Volver al centro de aprendizaje')}
            </button>
        </div>
    );
}

/** Para tests: lo que el buscador normaliza. */
export const __test = { fold };
