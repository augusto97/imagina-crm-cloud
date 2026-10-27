import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router';
import { Compass, X } from 'lucide-react';

import { useToastOptional } from '@/components/ui/toast';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { useHelpPanel } from './helpPanelStore';
import { useTourActive } from './tour/tourStore';
import { useGuideProgress, useHelpViewer, useUpdateGuideProgress } from './useHelpData';

/** Pantallas donde se puede ofrecer (no en un editor a pantalla completa). */
function isCalmRoute(pathname: string): boolean {
    return (
        pathname === '/lists' ||
        /^\/lists\/[^/]+\/records$/.test(pathname) ||
        pathname === '/my-work' ||
        pathname === '/favorites' ||
        pathname === '/dashboards' ||
        /^\/folders\/[^/]+$/.test(pathname)
    );
}

/**
 * ¿Hay otro diálogo abierto (una novedad destacada, un alta…)? Las capas de
 * ayuda se marcan con `data-help-overlay` y no cuentan. El ofrecimiento espera
 * a que se cierre en vez de aparecer detrás.
 */
function otherDialogOpen(): boolean {
    return (
        document.querySelector(
            '[role="dialog"][data-state="open"]:not([data-help-overlay]), [role="alertdialog"][data-state="open"]:not([data-help-overlay])',
        ) !== null
    );
}

/**
 * «¿Te muestro la app en 2 minutos?» — se ofrece UNA vez a cada persona en
 * cada empresa. «Ahora no» la deja en Ayuda. No aparece:
 *  - a invitados ni durante una impersonación (el operador no gasta el
 *    ofrecimiento de nadie);
 *  - si la empresa todavía no tiene listas y la persona puede crearlas: ahí
 *    manda la bienvenida de «Empezar fácil», que al terminar arranca este
 *    mismo recorrido;
 *  - mientras corre otro recorrido, está abierta la ayuda u otro diálogo
 *    (una novedad destacada, por ejemplo).
 */
export function WelcomeOffer({
    listsReady,
    listCount,
    onStart,
}: {
    listsReady: boolean;
    listCount: number;
    onStart: () => boolean;
}): JSX.Element | null {
    const viewer = useHelpViewer();
    const enabled = !viewer.isGuest && !viewer.impersonating;
    const progress = useGuideProgress(enabled);
    const update = useUpdateGuideProgress();
    const tourActive = useTourActive();
    const panel = useHelpPanel();
    const { pathname } = useLocation();
    const narrow = useMediaQuery('(max-width: 639px)');
    const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const toast = useToastOptional();
    const [ready, setReady] = useState(false);
    const [closed, setClosed] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);

    // Un respiro antes de ofrecerlo: que la pantalla termine de cargar.
    useEffect(() => {
        const t = window.setTimeout(() => setReady(true), 1200);
        return () => window.clearTimeout(t);
    }, []);

    // Mientras haya otro diálogo abierto, no se ofrece (se mira cada segundo:
    // un querySelector, y sólo re-dibuja si cambia).
    useEffect(() => {
        if (!enabled || closed) return;
        const check = (): void => setDialogOpen(otherDialogOpen());
        check();
        const t = window.setInterval(check, 1000);
        return () => window.clearInterval(t);
    }, [enabled, closed]);

    const p = progress.data;
    const eligible =
        enabled &&
        ready &&
        !closed &&
        p !== undefined &&
        !p.welcome_offered &&
        !p.completed.includes('welcome') &&
        !p.dismissed.includes('welcome') &&
        listsReady &&
        !(listCount === 0 && viewer.caps.has('manage_lists'));
    const show = eligible && !tourActive && !panel.open && !dialogOpen && isCalmRoute(pathname);
    if (!show) return null;

    const later = (): void => {
        setClosed(true);
        update.mutate({ welcome_offered: true });
        toast?.info(__('Cuando quieras, lo encuentras en Ayuda'), __('Arriba a la derecha, o en tu menú en el celular.'));
    };
    const start = (): void => {
        setClosed(true);
        onStart();
    };

    return createPortal(
        <div
            role="dialog"
            aria-modal="false"
            aria-labelledby="imcrm-welcome-offer-title"
            aria-describedby="imcrm-welcome-offer-body"
            data-testid="welcome-offer"
            data-help-overlay=""
            className={cn(
                'imcrm-fixed imcrm-z-[45] imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 imcrm-text-card-foreground imcrm-shadow-imcrm-xl',
                narrow ? 'imcrm-inset-x-3 imcrm-bottom-3' : 'imcrm-bottom-5 imcrm-right-5 imcrm-w-[340px]',
                !reducedMotion && 'imcrm-animate-imcrm-fade-in',
            )}
        >
            <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary">
                    <Compass className="imcrm-h-4 imcrm-w-4" aria-hidden />
                </span>
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <h2 id="imcrm-welcome-offer-title" className="imcrm-text-[15px] imcrm-font-semibold imcrm-leading-snug">
                        {__('¿Te muestro la app en 2 minutos?')}
                    </h2>
                    <p id="imcrm-welcome-offer-body" className="imcrm-mt-1 imcrm-text-[13px] imcrm-leading-relaxed imcrm-text-muted-foreground">
                        {__('Un recorrido corto por lo principal: tus listas, las vistas, la ficha de cada registro y dónde está todo.')}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={later}
                    aria-label={__('Cerrar')}
                    className="imcrm-inline-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                >
                    <X className="imcrm-h-4 imcrm-w-4" aria-hidden />
                </button>
            </div>
            <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                <button
                    type="button"
                    onClick={later}
                    data-testid="welcome-offer-later"
                    className="imcrm-inline-flex imcrm-h-8 imcrm-items-center imcrm-rounded-md imcrm-px-3 imcrm-text-[13px] imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                >
                    {__('Ahora no')}
                </button>
                <button
                    type="button"
                    onClick={start}
                    data-testid="welcome-offer-start"
                    className="imcrm-inline-flex imcrm-h-8 imcrm-items-center imcrm-rounded-md imcrm-bg-primary imcrm-px-3 imcrm-text-[13px] imcrm-font-medium imcrm-text-primary-foreground hover:imcrm-bg-primary/90 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40"
                >
                    {__('Empezar')}
                </button>
            </div>
        </div>,
        document.body,
    );
}
