import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { BookOpen, ChevronDown, ChevronRight, Compass, ExternalLink, GraduationCap, Keyboard, LifeBuoy, Lightbulb, Mail, Megaphone, MessageCircle, PlayCircle, Rocket, Search, X } from 'lucide-react';
import { helpScreensFor, whatsappDigits, type HelpSupport } from '@imagina-base/shared';

import { Sheet, SheetCloseButton, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { __, _n, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { GuideArticle } from './GuideArticle';
import { byCategory, guidesForScreens, searchGuides, type VisibleGuide } from './guideAccess';
import { help, useHelpAvailability } from './helpBus';
import { helpPanel, useHelpPanel } from './helpPanelStore';
import { TOURS } from './tours/tours';
import { useHelpGuides } from './useHelpGuides';
import { useHelpConfig } from './useHelpData';

/**
 * Fase 7 · entrega 2 — el panel «Ayuda»: buscador, guías de la pantalla
 * actual, «Empieza aquí», recorridos, categorías y el contacto de soporte.
 */
export function HelpPanel({
    onShowShortcuts,
    firstListSlug,
    appName,
}: {
    onShowShortcuts?: () => void;
    firstListSlug: string | null;
    appName: string;
}): JSX.Element {
    const panel = useHelpPanel();
    const guides = useHelpGuides(true);
    const config = useHelpConfig(true);
    const availability = useHelpAvailability();
    const location = useLocation();
    const navigate = useNavigate();
    const searchRef = useRef<HTMLInputElement | null>(null);
    const bodyRef = useRef<HTMLDivElement | null>(null);
    const [query, setQuery] = useState(panel.query);
    const [openCats, setOpenCats] = useState<Set<string>>(() => new Set());
    // Pantalla táctil: sin teclado físico (los atajos no aplican) y sin abrir
    // el teclado de la pantalla apenas se abre la ayuda.
    const touchOnly = useMediaQuery('(hover: none) and (pointer: coarse)');

    // Abierto desde afuera con una búsqueda o una guía: se toma esa.
    useEffect(() => {
        setQuery(panel.query);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [panel.seq]);

    // Al cambiar de guía, el contenido vuelve arriba.
    useEffect(() => {
        bodyRef.current?.scrollTo({ top: 0 });
    }, [panel.guideId]);

    const screens = useMemo(() => helpScreensFor(location.pathname, location.search), [location.pathname, location.search]);
    const here = useMemo(() => (guides ? guidesForScreens(guides, screens) : []), [guides, screens]);
    const results = useMemo(() => (guides && query.trim() !== '' ? searchGuides(guides, query) : []), [guides, query]);
    const categories = useMemo(() => (guides ? byCategory(guides) : []), [guides]);
    // `availability` cambia cada vez que una pieza se registra: re-evalúa qué
    // recorridos aplican a esta persona.
    const tours = useMemo(
        () => TOURS.filter((t) => t.id !== 'welcome' && help.hasTour(t.id)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [availability],
    );
    const hasWelcome = help.hasTour('welcome');

    const current = panel.guideId && guides ? (guides.find((g) => g.guide.id === panel.guideId) ?? null) : null;

    const openGuide = (id: string): void => helpPanel.showGuide(id);
    const goTo = (path: string): void => {
        helpPanel.close();
        navigate(path);
    };

    const toggleCat = (id: string): void =>
        setOpenCats((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    return (
        <Sheet open onOpenChange={(o) => !o && helpPanel.close()}>
            <SheetContent
                className="sm:imcrm-w-[420px]"
                data-testid="help-panel"
                data-help-overlay=""
                onOpenAutoFocus={(e) => {
                    // El foco va al buscador (o al título de la guía). En el
                    // teléfono no: abriría el teclado tapando media ayuda.
                    if (touchOnly && !panel.guideId) return;
                    e.preventDefault();
                    if (!panel.guideId) searchRef.current?.focus({ preventScroll: true });
                }}
            >
                <div className="imcrm-flex imcrm-shrink-0 imcrm-items-start imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-pb-3 imcrm-pt-4">
                    <div className="imcrm-min-w-0">
                        <SheetTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <LifeBuoy className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                            {__('Ayuda')}
                        </SheetTitle>
                        <SheetDescription className="imcrm-mt-0.5 imcrm-text-xs">
                            {__('Guías rápidas, recorridos y cómo pedir ayuda.')}
                        </SheetDescription>
                    </div>
                    <SheetCloseButton />
                </div>

                <div className="imcrm-shrink-0 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-3">
                    <label className="imcrm-relative imcrm-block">
                        <span className="imcrm-sr-only">{__('Buscar en la ayuda')}</span>
                        <Search
                            className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-1/2 imcrm-h-4 imcrm-w-4 -imcrm-translate-y-1/2 imcrm-text-muted-foreground"
                            aria-hidden
                        />
                        <input
                            ref={searchRef}
                            type="text"
                            role="searchbox"
                            enterKeyHint="search"
                            autoComplete="off"
                            value={query}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                if (panel.guideId) helpPanel.showGuide(null);
                            }}
                            placeholder={__('¿Qué quieres hacer? Ej.: importar un Excel')}
                            data-testid="help-search"
                            className="imcrm-h-9 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-pl-8 imcrm-pr-8 imcrm-text-[13px] placeholder:imcrm-text-muted-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                        />
                        {query !== '' && (
                            <button
                                type="button"
                                onClick={() => {
                                    setQuery('');
                                    searchRef.current?.focus();
                                }}
                                aria-label={__('Borrar la búsqueda')}
                                className="imcrm-absolute imcrm-right-1.5 imcrm-top-1/2 imcrm-inline-flex imcrm-h-6 imcrm-w-6 -imcrm-translate-y-1/2 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-text-foreground"
                            >
                                <X className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            </button>
                        )}
                    </label>
                </div>

                <div ref={bodyRef} className="imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-5 imcrm-py-4" data-testid="help-body">
                    {guides === null ? (
                        <p className="imcrm-text-sm imcrm-text-muted-foreground">{__('Cargando la ayuda…')}</p>
                    ) : current ? (
                        <GuideArticle
                            item={current}
                            guides={guides}
                            firstListSlug={firstListSlug}
                            appName={appName}
                            onBack={() => helpPanel.showGuide(null)}
                            onOpenGuide={openGuide}
                            onNavigate={goTo}
                        />
                    ) : query.trim() !== '' ? (
                        <section aria-label={__('Resultados')} data-testid="help-results">
                            <p className="imcrm-mb-2 imcrm-text-xs imcrm-text-muted-foreground" aria-live="polite">
                                {results.length === 0
                                    ? sprintf(__('No encontré guías para «%s».'), query.trim())
                                    : sprintf(_n('%d guía', '%d guías', results.length), results.length)}
                            </p>
                            {results.length > 0 ? (
                                <GuideList items={results} onOpen={openGuide} />
                            ) : (
                                <p className="imcrm-text-[13px] imcrm-leading-relaxed imcrm-text-muted-foreground">
                                    {__('Prueba con otras palabras (por ejemplo «importar», «permisos» o «correo»), o mira las categorías.')}
                                </p>
                            )}
                        </section>
                    ) : (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-6">
                            <button
                                type="button"
                                onClick={() => goTo('/aprende')}
                                data-testid="help-learn-center"
                                className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-primary/25 imcrm-p-3.5 imcrm-text-left hover:imcrm-border-primary/50 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                                style={{ background: 'linear-gradient(120deg, hsl(var(--imcrm-primary) / .12), hsl(var(--imcrm-tone-violet) / .1))' }}
                            >
                                <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary imcrm-text-primary-foreground">
                                    <GraduationCap className="imcrm-h-5 imcrm-w-5" aria-hidden />
                                </span>
                                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                                    <span className="imcrm-text-sm imcrm-font-semibold">{__('Centro de aprendizaje')}</span>
                                    <span className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">
                                        {__('Guías completas de cada parte de la app, con animaciones y capturas paso a paso.')}
                                    </span>
                                </span>
                                <ChevronRight className="imcrm-ml-auto imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                            </button>
                            <button
                                type="button"
                                onClick={() => goTo('/ideas')}
                                data-testid="help-ideas"
                                className="-imcrm-mt-4 imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-amber-500/30 imcrm-p-3.5 imcrm-text-left hover:imcrm-border-amber-500/60 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                                style={{ background: 'linear-gradient(120deg, hsl(var(--imcrm-tone-amber) / .14), hsl(var(--imcrm-primary) / .06))' }}
                            >
                                <span className="imcrm-flex imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-amber-500 imcrm-text-white">
                                    <Lightbulb className="imcrm-h-5 imcrm-w-5" aria-hidden />
                                </span>
                                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                                    <span className="imcrm-text-sm imcrm-font-semibold">{__('Ideas para tu negocio')}</span>
                                    <span className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">
                                        {__('Casos de uso listos: recordatorios de pago, avisos por WhatsApp, agendas… y se activan con un clic.')}
                                    </span>
                                </span>
                                <ChevronRight className="imcrm-ml-auto imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                            </button>

                            {here.length > 0 && (
                                <Section title={__('En esta pantalla')} testId="help-here">
                                    <GuideList items={here} onOpen={openGuide} />
                                </Section>
                            )}

                            <Section title={__('Empieza aquí')} testId="help-start">
                                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                                    {hasWelcome && (
                                        <StartCard
                                            icon={Compass}
                                            title={__('Recorrido por la app')}
                                            hint={__('2 minutos')}
                                            onClick={() => help.startTour('welcome')}
                                            testId="help-start-tour"
                                        />
                                    )}
                                    {availability.gettingStarted && (
                                        <StartCard
                                            icon={Rocket}
                                            title={__('Primeros pasos')}
                                            hint={__('Lo que te falta para arrancar')}
                                            onClick={() => {
                                                helpPanel.close();
                                                help.openGettingStarted();
                                            }}
                                        />
                                    )}
                                    {onShowShortcuts && !touchOnly && (
                                        <StartCard
                                            icon={Keyboard}
                                            title={__('Atajos de teclado')}
                                            hint={__('Tecla ?')}
                                            onClick={() => {
                                                helpPanel.close();
                                                onShowShortcuts();
                                            }}
                                            testId="help-shortcuts"
                                        />
                                    )}
                                    {availability.whatsNew && (
                                        <StartCard
                                            icon={Megaphone}
                                            title={__('Novedades')}
                                            hint={__('Lo nuevo en la app')}
                                            onClick={() => {
                                                helpPanel.close();
                                                help.openWhatsNew();
                                            }}
                                        />
                                    )}
                                </div>
                            </Section>

                            <Section title={__('Guías por tema')} testId="help-categories">
                                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border">
                                    {tours.length > 0 && (
                                        <li>
                                            <CategoryToggle
                                                label={__('Recorridos guiados')}
                                                count={tours.length}
                                                open={openCats.has('__tours')}
                                                onToggle={() => toggleCat('__tours')}
                                                icon={PlayCircle}
                                            />
                                            {openCats.has('__tours') && (
                                                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5 imcrm-px-2 imcrm-pb-2" data-testid="help-tours">
                                                    {tours.map((t) => (
                                                        <li key={t.id}>
                                                            <button
                                                                type="button"
                                                                onClick={() => help.startTour(t.id)}
                                                                data-testid={`help-tour-${t.id}`}
                                                                className="imcrm-flex imcrm-w-full imcrm-items-start imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2 imcrm-py-2 imcrm-text-left hover:imcrm-bg-accent focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                                                            >
                                                                <PlayCircle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-primary" aria-hidden />
                                                                <span className="imcrm-min-w-0">
                                                                    <span className="imcrm-block imcrm-text-[13px] imcrm-font-medium">{__(t.title)}</span>
                                                                    <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__(t.description).replace(/\{app\}/g, appName)}</span>
                                                                    <span className="imcrm-mt-0.5 imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground/80">{sprintf(__('%d min'), t.minutes)}</span>
                                                                </span>
                                                            </button>
                                                        </li>
                                                    ))}
                                                    <li>
                                                        <button
                                                            type="button"
                                                            onClick={() => goTo('/aprende#recorridos')}
                                                            data-testid="help-tours-gallery"
                                                            className="imcrm-mt-1 imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                                                        >
                                                            {__('Ver todos con sus ilustraciones')}
                                                            <ChevronRight className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                                        </button>
                                                    </li>
                                                </ul>
                                            )}
                                        </li>
                                    )}
                                    {categories.map((c) => (
                                        <li key={c.id}>
                                            <CategoryToggle
                                                label={__(c.label)}
                                                count={c.guides.length}
                                                open={openCats.has(c.id)}
                                                onToggle={() => toggleCat(c.id)}
                                                icon={BookOpen}
                                                testId={`help-cat-${c.id}`}
                                            />
                                            {openCats.has(c.id) && (
                                                <div className="imcrm-px-2 imcrm-pb-2">
                                                    <GuideList items={c.guides} onOpen={openGuide} dense />
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </Section>

                            <SupportCard support={config.support} />
                        </div>
                    )}
                </div>
            </SheetContent>
        </Sheet>
    );
}

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }): JSX.Element {
    return (
        <section aria-label={title} data-testid={testId}>
            <h3 className="imcrm-mb-2 imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{title}</h3>
            {children}
        </section>
    );
}

function StartCard({
    icon: Icon,
    title,
    hint,
    onClick,
    testId,
}: {
    icon: typeof Compass;
    title: string;
    hint: string;
    onClick: () => void;
    testId?: string;
}): JSX.Element {
    return (
        <button
            type="button"
            onClick={onClick}
            data-testid={testId}
            className="imcrm-flex imcrm-flex-col imcrm-items-start imcrm-gap-1.5 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3 imcrm-text-left imcrm-transition-colors hover:imcrm-border-primary/40 hover:imcrm-bg-accent/40 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
        >
            <span className="imcrm-flex imcrm-h-7 imcrm-w-7 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-primary/10 imcrm-text-primary">
                <Icon className="imcrm-h-4 imcrm-w-4" aria-hidden />
            </span>
            <span className="imcrm-text-[13px] imcrm-font-medium imcrm-leading-tight">{title}</span>
            <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{hint}</span>
        </button>
    );
}

function CategoryToggle({
    label,
    count,
    open,
    onToggle,
    icon: Icon,
    testId,
}: {
    label: string;
    count: number;
    open: boolean;
    onToggle: () => void;
    icon: typeof BookOpen;
    testId?: string;
}): JSX.Element {
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            data-testid={testId}
            className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2.5 imcrm-px-3 imcrm-py-2.5 imcrm-text-left imcrm-text-[13px] imcrm-font-medium hover:imcrm-bg-accent/40 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-inset focus-visible:imcrm-ring-ring"
        >
            <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
            <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{label}</span>
            <span className="imcrm-rounded-full imcrm-bg-muted imcrm-px-1.5 imcrm-text-[11px] imcrm-tabular-nums imcrm-text-muted-foreground">{count}</span>
            {open ? (
                <ChevronDown className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
            ) : (
                <ChevronRight className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
            )}
        </button>
    );
}

export function GuideList({
    items,
    onOpen,
    dense = false,
}: {
    items: readonly VisibleGuide[];
    onOpen: (id: string) => void;
    dense?: boolean;
}): JSX.Element {
    return (
        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5">
            {items.map(({ guide, restricted }) => (
                <li key={guide.id}>
                    <button
                        type="button"
                        onClick={() => onOpen(guide.id)}
                        data-testid={`help-guide-${guide.id}`}
                        className={cn(
                            'imcrm-flex imcrm-w-full imcrm-items-start imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2 imcrm-text-left hover:imcrm-bg-accent focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring',
                            dense ? 'imcrm-py-1.5' : 'imcrm-py-2',
                        )}
                    >
                        <BookOpen className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                        <span className="imcrm-min-w-0 imcrm-flex-1">
                            <span className="imcrm-block imcrm-text-[13px] imcrm-leading-snug">{guide.title}</span>
                            <span className="imcrm-mt-0.5 imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                                <span>{sprintf(__('%d min'), guide.minutes)}</span>
                                {restricted && <span className="imcrm-text-warning">{__('Lo hace un administrador')}</span>}
                                {guide.source === 'custom' && <span>{__('Guía de soporte')}</span>}
                            </span>
                        </span>
                        <ChevronRight className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground/60" aria-hidden />
                    </button>
                </li>
            ))}
        </ul>
    );
}

/** «¿Necesitas más ayuda?» — sólo lo que configuró el operador. */
export function SupportCard({ support }: { support: HelpSupport }): JSX.Element | null {
    const has = Boolean(support.email || support.whatsapp || support.url);
    if (!has) return null;
    const linkClass =
        'imcrm-inline-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-3 imcrm-py-2 imcrm-text-[13px] imcrm-font-medium hover:imcrm-bg-accent focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring';
    return (
        <section aria-label={__('¿Necesitas más ayuda?')} className="imcrm-rounded-lg imcrm-bg-muted/50 imcrm-p-4" data-testid="help-support">
            <h3 className="imcrm-text-[13px] imcrm-font-semibold">{__('¿Necesitas más ayuda?')}</h3>
            <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                {support.note ?? __('Escríbenos y te ayudamos.')}
            </p>
            <div className="imcrm-mt-3 imcrm-flex imcrm-flex-col imcrm-gap-2">
                {support.email && (
                    <a href={`mailto:${support.email}`} className={linkClass}>
                        <Mail className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                        <span className="imcrm-truncate">{support.email}</span>
                    </a>
                )}
                {support.whatsapp && (
                    <a href={`https://wa.me/${whatsappDigits(support.whatsapp)}`} target="_blank" rel="noopener noreferrer" className={linkClass}>
                        <MessageCircle className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                        <span className="imcrm-truncate">{sprintf(__('WhatsApp %s'), support.whatsapp)}</span>
                    </a>
                )}
                {support.url && (
                    <a href={support.url} target="_blank" rel="noopener noreferrer" className={linkClass}>
                        <ExternalLink className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                        <span className="imcrm-truncate">{__('Centro de ayuda')}</span>
                    </a>
                )}
            </div>
        </section>
    );
}
