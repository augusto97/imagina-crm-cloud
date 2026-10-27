import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, ChevronRight, CircleDashed, EyeOff, Loader2, PartyPopper, Play, SkipForward, Trash2, Undo2, X } from 'lucide-react';
import type { OnboardingStatus, OnboardingStep } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { useToastOptional } from '@/components/ui/toast';
import { InstallAppDialog } from '@/components/pwa/InstallAppDialog';
import { assistantPanel } from '@/admin/assistant/assistantPanelStore';
import { help, registerHelpHandlers, useHasTour } from '@/admin/help/helpBus';
import { onboardingKeys, useDeleteSamples, useOnboardingAiStatus, useOnboardingStatus, useUpdateOnboardingPrefs } from '@/hooks/useOnboarding';
import { useIsGuest } from '@/lib/guest';
import { __, _n, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { currentAppName } from '@/lib/pwa/appMeta';
import { deviceInfo } from '@/lib/pwa/platform';
import { promptInstall, useInstallMode } from '@/lib/pwa/install';
import { cn } from '@/lib/utils';

import { ADD_MORE_ICON, STEP_META, stepAction, stepProgress } from './gettingStartedSteps';
import { useFinishWelcome } from './useFinishWelcome';

// «Agrega más con IA» abre la bienvenida completa: se baja sólo si se usa.
const WelcomeDialog = lazy(() => import('./WelcomeDialog').then((m) => ({ default: m.WelcomeDialog })));

/** Cuánto dura la celebración antes de que el widget se oculte solo. */
const CELEBRATE_MS = 6000;

/**
 * F7 (ADR-S72) — «Primeros pasos»: el widget flotante abajo a la derecha
 * («Primeros pasos · 3 de 8») que se abre como panel. Cada paso se marca solo
 * con datos reales (lo calcula el servidor); aquí se dice por qué sirve, se
 * lleva al lugar exacto («Hacerlo»), se muestra el recorrido si existe
 * («Muéstrame») o se salta. Registra `openGettingStarted` en el helpBus.
 */
export function GettingStarted({ onCreateList }: { onCreateList: () => void }): JSX.Element | null {
    const isGuest = useIsGuest();
    const status = useOnboardingStatus(!isGuest);
    const data = status.data;
    const prefs = useUpdateOnboardingPrefs();
    const qc = useQueryClient();
    const location = useLocation();
    const navigate = useNavigate();
    const toast = useToastOptional();
    const installMode = useInstallMode();
    const samples = useDeleteSamples();
    const canDeleteRecords = useCan(CAP.DELETE_RECORDS);
    const canManageLists = useCan(CAP.MANAGE_LISTS);
    const finishWelcome = useFinishWelcome();

    const [open, setOpen] = useState(false);
    /** Abierto a pedido (menú de la persona): se muestra aunque esté oculto o completo. */
    const [forced, setForced] = useState(false);
    const [addMore, setAddMore] = useState(false);
    const [installHelp, setInstallHelp] = useState(false);
    const [celebrating, setCelebrating] = useState(false);
    const pillRef = useRef<HTMLButtonElement>(null);
    /** Cerrar con Escape o la X devuelve el foco al botón; «Hacerlo» lo deja donde lleva. */
    const returnFocus = useRef(false);

    const audience = data?.audience ?? 'none';
    const canAddMore = canManageLists && audience === 'admin';
    // Sólo se pregunta con el panel abierto: decide si «Agrega más» arranca con la IA o con las plantillas.
    const aiStatus = useOnboardingAiStatus(canAddMore && open);
    const aiReady = aiStatus.data?.available === true;
    const hasSteps = audience !== 'none' && (data?.steps.length ?? 0) > 0;
    const finished = data ? data.complete && data.prefs.celebrated : false;
    const onWelcomePage = data?.welcome === true && (location.pathname === '/lists' || location.pathname === '/');
    const visible = hasSteps && !onWelcomePage && (forced || (!data!.prefs.hidden && !finished));
    const live = hasSteps && !finished;

    // ── El helpBus: «Primeros pasos» se puede abrir desde cualquier lado ──
    const openRef = useRef<() => void>(() => undefined);
    openRef.current = () => {
        if (!data || !hasSteps) return;
        setForced(true);
        setOpen(true);
        if (data.prefs.hidden) prefs.mutate({ hidden: false });
        void qc.invalidateQueries({ queryKey: onboardingKeys.status() });
    };
    useEffect(() => {
        if (!hasSteps) return;
        return registerHelpHandlers({ openGettingStarted: () => openRef.current() });
    }, [hasSteps]);

    // ── Que los pasos se marquen solos ──
    // Después de cualquier cambio exitoso en la app (invitar, crear una
    // vista…) se vuelve a preguntar, con una pausa para juntar varios.
    useEffect(() => {
        if (!live) return;
        let timer: number | undefined;
        const unsubscribe = qc.getMutationCache().subscribe((ev) => {
            if (ev.type !== 'updated' || ev.action.type !== 'success') return;
            window.clearTimeout(timer);
            timer = window.setTimeout(() => void qc.invalidateQueries({ queryKey: onboardingKeys.status() }), 1200);
        });
        return () => {
            unsubscribe();
            window.clearTimeout(timer);
        };
    }, [live, qc]);

    // Pasos que no dejan datos: abrir «Mi trabajo» y usar la app instalada.
    const stepById = useMemo(() => new Map((data?.steps ?? []).map((s) => [s.id, s])), [data?.steps]);
    const markPending = (id: 'my_work' | 'install_app'): boolean => {
        const s = stepById.get(id);
        return s !== undefined && !s.done;
    };
    useEffect(() => {
        if (!live) return;
        if (location.pathname.startsWith('/my-work') && markPending('my_work')) prefs.mutate({ mark: 'my_work' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.pathname, live]);
    useEffect(() => {
        if (!live) return;
        if (deviceInfo().standalone && markPending('install_app')) prefs.mutate({ mark: 'install_app' });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [live, stepById]);

    // ── Celebrar al terminar (una sola vez) y ocultarse solo ──
    useEffect(() => {
        if (!data || !hasSteps || !data.complete || data.prefs.celebrated || data.prefs.hidden) return;
        setCelebrating(true);
        const t = window.setTimeout(() => {
            setCelebrating(false);
            setOpen(false);
            prefs.mutate({ celebrated: true });
        }, CELEBRATE_MS);
        return () => window.clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data?.complete, data?.prefs.celebrated, data?.prefs.hidden, hasSteps]);

    const onOpenChange = useCallback(
        (next: boolean) => {
            setOpen(next);
            if (next) void qc.invalidateQueries({ queryKey: onboardingKeys.status() });
            else setForced(false);
        },
        [qc],
    );

    if (!data || !visible) {
        return addMore ? (
            <Suspense fallback={null}>
                <WelcomeDialog open={addMore} onOpenChange={setAddMore} initialPath={aiReady ? 'ai' : 'choose'} onCreated={finishWelcome} />
            </Suspense>
        ) : null;
    }

    const progress = stepProgress(data.steps);
    const samplesLeft = data.samples.reduce((n, s) => n + s.count, 0);

    const doStep = (step: OnboardingStep): void => {
        const action = stepAction(step.id, data, { appInstalled: installMode === null });
        setOpen(false);
        setForced(false);
        switch (action.kind) {
            case 'navigate':
                navigate(action.to);
                return;
            case 'create-list':
                onCreateList();
                return;
            case 'open-assistant':
                assistantPanel.open();
                return;
            case 'install':
                if (installMode === 'prompt') {
                    void promptInstall().then((ok) => {
                        if (ok) prefs.mutate({ mark: 'install_app' });
                    });
                } else {
                    setInstallHelp(true);
                }
        }
    };

    const showMe = (tour: string): void => {
        setOpen(false);
        setForced(false);
        window.setTimeout(() => help.startTour(tour), 150);
    };

    const hide = (): void => {
        setOpen(false);
        setForced(false);
        prefs.mutate({ hidden: true });
        toast?.info(__('Primeros pasos quedó oculto'), __('Lo vuelves a abrir desde tu menú, arriba a la derecha.'));
    };

    return (
        <>
            <Popover open={open || celebrating} onOpenChange={onOpenChange}>
                <PopoverAnchor asChild>
                    <div className="imcrm-pointer-events-none imcrm-fixed imcrm-bottom-3 imcrm-right-3 imcrm-z-30 sm:imcrm-bottom-4 sm:imcrm-right-4">
                        <button
                            ref={pillRef}
                            type="button"
                            onClick={() => onOpenChange(!open)}
                            aria-expanded={open}
                            aria-haspopup="dialog"
                            aria-label={sprintf(__('Primeros pasos: %1$d de %2$d'), progress.done, progress.total)}
                            className={cn(
                                'imcrm-pointer-events-auto imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-full imcrm-border imcrm-border-border imcrm-bg-card imcrm-py-1.5 imcrm-pl-1.5 imcrm-pr-3 imcrm-text-[13px] imcrm-font-medium imcrm-text-foreground imcrm-shadow-imcrm-md',
                                'imcrm-transition-colors hover:imcrm-border-primary/40 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/50',
                            )}
                            data-tour="getting-started"
                            data-testid="getting-started"
                        >
                            <ProgressRing ratio={progress.ratio} />
                            <span className="imcrm-hidden sm:imcrm-inline">{__('Primeros pasos')}</span>
                            <span className="imcrm-tabular-nums imcrm-text-muted-foreground" data-testid="getting-started-count">
                                <span className="sm:imcrm-hidden">{`${progress.done}/${progress.total}`}</span>
                                <span className="imcrm-hidden sm:imcrm-inline">{` · ${sprintf(__('%1$d de %2$d'), progress.done, progress.total)}`}</span>
                            </span>
                        </button>
                    </div>
                </PopoverAnchor>
                <PopoverContent
                    side="top"
                    align="end"
                    sideOffset={10}
                    className="imcrm-flex imcrm-w-[min(24rem,calc(100vw-1.5rem))] imcrm-flex-col imcrm-gap-0 imcrm-overflow-hidden imcrm-rounded-xl imcrm-p-0"
                    aria-label={__('Primeros pasos')}
                    data-testid="getting-started-panel"
                    onOpenAutoFocus={(e) => {
                        if (celebrating && !open) e.preventDefault();
                    }}
                    onEscapeKeyDown={() => {
                        returnFocus.current = true;
                    }}
                    onCloseAutoFocus={(e) => {
                        e.preventDefault();
                        if (returnFocus.current) pillRef.current?.focus();
                        returnFocus.current = false;
                    }}
                >
                    {celebrating ? (
                        <Celebration
                            onClose={() => {
                                setCelebrating(false);
                                setOpen(false);
                                prefs.mutate({ celebrated: true });
                            }}
                        />
                    ) : (
                        <Panel
                            status={data}
                            progress={progress}
                            samplesLeft={canDeleteRecords ? samplesLeft : 0}
                            deletingSamples={samples.pending}
                            canAddMore={canAddMore}
                            aiReady={aiReady}
                            onClose={() => {
                                returnFocus.current = true;
                                onOpenChange(false);
                            }}
                            onDo={doStep}
                            onShowMe={showMe}
                            onSkip={(id) => prefs.mutate({ skip: id })}
                            onUnskip={(id) => prefs.mutate({ unskip: id })}
                            onDeleteSamples={() => void samples.run()}
                            onAddMore={() => {
                                setOpen(false);
                                setForced(false);
                                setAddMore(true);
                            }}
                            onHide={hide}
                        />
                    )}
                </PopoverContent>
            </Popover>
            {addMore && (
                <Suspense fallback={null}>
                    <WelcomeDialog open={addMore} onOpenChange={setAddMore} initialPath={aiReady ? 'ai' : 'choose'} onCreated={finishWelcome} />
                </Suspense>
            )}
            {installHelp && (
                <InstallAppDialog
                    open={installHelp}
                    onOpenChange={setInstallHelp}
                    appName={currentAppName()}
                    onInstalled={() => prefs.mutate({ mark: 'install_app' })}
                />
            )}
        </>
    );
}

function ProgressRing({ ratio, size = 26 }: { ratio: number; size?: number }): JSX.Element {
    const r = (size - 4) / 2;
    const c = 2 * Math.PI * r;
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="imcrm-shrink-0 -imcrm-rotate-90">
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={3} className="imcrm-stroke-muted" />
            <circle
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                strokeWidth={3}
                strokeLinecap="round"
                strokeDasharray={c}
                strokeDashoffset={c * (1 - ratio)}
                className="imcrm-stroke-primary motion-safe:imcrm-transition-[stroke-dashoffset] motion-safe:imcrm-duration-500"
            />
        </svg>
    );
}

function Panel({
    status,
    progress,
    samplesLeft,
    deletingSamples,
    canAddMore,
    aiReady,
    onClose,
    onDo,
    onShowMe,
    onSkip,
    onUnskip,
    onDeleteSamples,
    onAddMore,
    onHide,
}: {
    status: OnboardingStatus;
    progress: { done: number; total: number; ratio: number };
    samplesLeft: number;
    deletingSamples: boolean;
    canAddMore: boolean;
    aiReady: boolean;
    onClose: () => void;
    onDo: (step: OnboardingStep) => void;
    onShowMe: (tour: string) => void;
    onSkip: (id: OnboardingStep['id']) => void;
    onUnskip: (id: OnboardingStep['id']) => void;
    onDeleteSamples: () => void;
    onAddMore: () => void;
    onHide: () => void;
}): JSX.Element {
    const firstPending = status.steps.find((s) => !s.done && !s.skipped)?.id ?? null;
    const [expanded, setExpanded] = useState<string | null>(firstPending);
    const AddMore = ADD_MORE_ICON;
    return (
        <>
            <div className="imcrm-flex imcrm-shrink-0 imcrm-flex-col imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-p-4">
                <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                    <div className="imcrm-flex imcrm-flex-col">
                        <p className="imcrm-text-sm imcrm-font-semibold imcrm-text-foreground">{__('Primeros pasos')}</p>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {status.complete
                                ? __('¡Completaste todo! Ya conoces lo más importante.')
                                : sprintf(__('%1$d de %2$d listos. Se marcan solos cuando los haces.'), progress.done, progress.total)}
                        </p>
                    </div>
                    <Button variant="ghost" size="icon" className="imcrm-h-7 imcrm-w-7 imcrm-shrink-0" onClick={onClose} aria-label={__('Cerrar')}>
                        <X className="imcrm-h-4 imcrm-w-4" />
                    </Button>
                </div>
                <div className="imcrm-h-1.5 imcrm-w-full imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                    <div className="imcrm-h-full imcrm-rounded-full imcrm-bg-primary motion-safe:imcrm-transition-[width] motion-safe:imcrm-duration-500" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
                </div>
            </div>

            <ol className="imcrm-flex imcrm-max-h-[26rem] imcrm-min-h-0 imcrm-shrink imcrm-flex-col imcrm-overflow-y-auto imcrm-p-1.5" data-testid="getting-started-steps">
                {status.steps.map((step) => (
                    <StepRow
                        key={step.id}
                        step={step}
                        expanded={expanded === step.id}
                        onToggle={() => setExpanded((cur) => (cur === step.id ? null : step.id))}
                        onDo={() => onDo(step)}
                        onShowMe={onShowMe}
                        onSkip={() => onSkip(step.id)}
                        onUnskip={() => onUnskip(step.id)}
                    />
                ))}
            </ol>

            {(samplesLeft > 0 || canAddMore) && (
                <div className="imcrm-flex imcrm-shrink-0 imcrm-flex-col imcrm-gap-1 imcrm-border-t imcrm-border-border imcrm-p-1.5">
                    {canAddMore && (
                        <button type="button" onClick={onAddMore} className={footerItem} data-testid="getting-started-add-more">
                            <AddMore className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                            {aiReady ? __('Agrega más con IA') : __('Agrega más listas')}
                        </button>
                    )}
                    {samplesLeft > 0 && (
                        <button type="button" onClick={onDeleteSamples} disabled={deletingSamples} className={footerItem} data-testid="getting-started-delete-samples">
                            {deletingSamples ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Trash2 className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />}
                            {sprintf(_n('Borrar el dato de ejemplo (%d)', 'Borrar los datos de ejemplo (%d)', samplesLeft), samplesLeft)}
                        </button>
                    )}
                </div>
            )}

            <div className="imcrm-flex imcrm-shrink-0 imcrm-justify-end imcrm-border-t imcrm-border-border imcrm-px-3 imcrm-py-2">
                <button type="button" onClick={onHide} className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground" data-testid="getting-started-hide">
                    <EyeOff className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {__('Ocultar primeros pasos')}
                </button>
            </div>
        </>
    );
}

const footerItem =
    'imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2.5 imcrm-py-2 imcrm-text-left imcrm-text-[13px] imcrm-text-foreground hover:imcrm-bg-accent disabled:imcrm-opacity-60 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40';

function StepRow({
    step,
    expanded,
    onToggle,
    onDo,
    onShowMe,
    onSkip,
    onUnskip,
}: {
    step: OnboardingStep;
    expanded: boolean;
    onToggle: () => void;
    onDo: () => void;
    onShowMe: (tour: string) => void;
    onSkip: () => void;
    onUnskip: () => void;
}): JSX.Element {
    const meta = STEP_META[step.id];
    const hasTour = useHasTour(meta.tour);
    const Icon = meta.icon;
    const pending = !step.done && !step.skipped;
    return (
        <li className={cn('imcrm-rounded-lg', expanded && pending && 'imcrm-bg-accent/50')} data-testid="getting-started-step" data-step={step.id} data-done={step.done ? '1' : '0'} data-skipped={step.skipped ? '1' : '0'}>
            <button
                type="button"
                onClick={onToggle}
                aria-expanded={expanded}
                className="imcrm-flex imcrm-w-full imcrm-items-center imcrm-gap-2.5 imcrm-rounded-lg imcrm-px-2.5 imcrm-py-2 imcrm-text-left hover:imcrm-bg-accent/60 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40"
            >
                <span className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center" aria-hidden>
                    {step.done ? (
                        <span className="imcrm-flex imcrm-h-5 imcrm-w-5 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-success imcrm-text-white">
                            <Check className="imcrm-h-3.5 imcrm-w-3.5" strokeWidth={3} />
                        </span>
                    ) : step.skipped ? (
                        <SkipForward className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    ) : (
                        <CircleDashed className="imcrm-h-5 imcrm-w-5 imcrm-text-muted-foreground" />
                    )}
                </span>
                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-2">
                    <Icon className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                    <span className={cn('imcrm-text-[13px]', step.done ? 'imcrm-text-muted-foreground imcrm-line-through' : step.skipped ? 'imcrm-text-muted-foreground' : 'imcrm-font-medium imcrm-text-foreground')}>
                        {__(meta.title)}
                    </span>
                </span>
                <span className="imcrm-sr-only">{step.done ? __('Listo') : step.skipped ? __('Saltado') : __('Pendiente')}</span>
                {!step.done && (expanded ? <ChevronDown className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden /> : <ChevronRight className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />)}
            </button>
            {expanded && !step.done && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-pb-2.5 imcrm-pl-[3.1rem] imcrm-pr-2.5">
                    <p className="imcrm-text-xs imcrm-leading-snug imcrm-text-muted-foreground">{__(meta.why)}</p>
                    {step.skipped ? (
                        <div>
                            <Button size="sm" variant="outline" className="imcrm-h-7 imcrm-gap-1.5 imcrm-text-xs" onClick={onUnskip} data-testid="getting-started-unskip">
                                <Undo2 className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Retomar este paso')}
                            </Button>
                        </div>
                    ) : (
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                            <Button size="sm" className="imcrm-h-7 imcrm-text-xs" onClick={onDo} data-testid="getting-started-do">
                                {__('Hacerlo')}
                            </Button>
                            {hasTour && meta.tour && (
                                <Button size="sm" variant="outline" className="imcrm-h-7 imcrm-gap-1 imcrm-text-xs" onClick={() => onShowMe(meta.tour!)} data-testid="getting-started-show-me">
                                    <Play className="imcrm-h-3 imcrm-w-3" />
                                    {__('Muéstrame')}
                                </Button>
                            )}
                            <Button size="sm" variant="ghost" className="imcrm-h-7 imcrm-text-xs imcrm-text-muted-foreground" onClick={onSkip} data-testid="getting-started-skip">
                                {__('Saltar este paso')}
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </li>
    );
}

function Celebration({ onClose }: { onClose: () => void }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-gap-3 imcrm-p-6 imcrm-text-center" role="status" aria-live="polite" data-testid="getting-started-celebration">
            <span className="imcrm-flex imcrm-h-14 imcrm-w-14 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary/10 imcrm-text-primary motion-safe:imcrm-animate-bounce">
                <PartyPopper className="imcrm-h-7 imcrm-w-7" aria-hidden />
            </span>
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <p className="imcrm-text-base imcrm-font-semibold imcrm-text-foreground">{__('¡Completaste los primeros pasos!')}</p>
                <p className="imcrm-text-[13px] imcrm-text-muted-foreground">
                    {__('Ya conoces lo más importante. Si los quieres ver otra vez, están en tu menú.')}
                </p>
            </div>
            <Button size="sm" variant="outline" onClick={onClose}>
                {__('Listo')}
            </Button>
        </div>
    );
}
