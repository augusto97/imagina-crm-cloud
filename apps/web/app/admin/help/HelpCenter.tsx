import { Suspense, useCallback, useEffect, useMemo, useRef } from 'react';

import { InstallOffer } from '@/components/pwa/InstallOffer';
import { useBrandingData } from '@/hooks/useBranding';
import { useLists } from '@/hooks/useLists';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { __ } from '@/lib/i18n';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { useInstallMode } from '@/lib/pwa/install';

import { registerHelpHandlers } from './helpBus';
import { helpPanel, useHelpPanel } from './helpPanelStore';
import { buildRun, fillAppName, resolveSteps } from './tour/resolve';
import { tourStore } from './tour/tourStore';
import type { TourContext } from './tour/tourTypes';
import { TourLayer, type TourOutcome } from './tour/TourLayer';
import { tourById } from './tours/tours';
import { useHelpViewer, useUpdateGuideProgress } from './useHelpData';

import { WelcomeOffer } from './WelcomeOffer';

const HelpPanel = lazyWithReload(() => import('./HelpPanel').then((m) => ({ default: m.HelpPanel })));

/**
 * Fase 7 · entrega 2 — el centro de ayuda: registra en el `helpBus` lo que
 * implementa esta pieza (recorridos y panel de Ayuda), y monta la capa de los
 * recorridos, el panel y el ofrecimiento del recorrido de bienvenida.
 *
 * Vive dentro del shell del equipo (`AdminShell`): un invitado tiene su propio
 * shell y no recibe nada de esto, y el portal del cliente es otro mundo.
 */
export function HelpCenter({ onShowShortcuts }: { onShowShortcuts?: () => void }): JSX.Element {
    const viewer = useHelpViewer();
    const lists = useLists();
    const branding = useBrandingData();
    const isMobile = useMediaQuery('(max-width: 1023px)');
    const installMode = useInstallMode();
    const panel = useHelpPanel();
    const updateProgress = useUpdateGuideProgress();

    const ctx = useMemo<TourContext>(() => {
        const first = lists.data?.[0] ?? null;
        return {
            can: (cap) => viewer.caps.has(cap),
            role: viewer.role,
            isAdmin: viewer.isAdmin,
            isSuperadmin: false,
            isMobile,
            firstList: first ? { slug: first.slug, name: first.name } : null,
            listCount: lists.data?.length ?? 0,
            appName: branding.data?.app_name?.trim() || __('la app'),
            canInstall: installMode !== null,
        };
    }, [viewer, lists.data, isMobile, branding.data?.app_name, installMode]);

    const ctxRef = useRef(ctx);
    ctxRef.current = ctx;
    const panelOpenRef = useRef(panel.open);
    panelOpenRef.current = panel.open;

    const persist = useCallback(
        (patch: Parameters<typeof updateProgress.mutate>[0]) => {
            // Mirando la app como otra persona (soporte) no se le gasta nada.
            if (viewer.impersonating) return;
            updateProgress.mutate(patch);
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [viewer.impersonating],
    );

    const hasTour = useCallback((id: string): boolean => {
        const def = tourById(id);
        if (!def || viewer.isGuest) return false;
        const c = ctxRef.current;
        return def.available(c) && resolveSteps(def, c).length > 0;
    }, [viewer.isGuest]);

    const startTour = useCallback(
        (id: string, opts?: { skipIntro?: boolean }): boolean => {
            if (!hasTour(id)) return false;
            const def = tourById(id)!;
            const { steps, meta } = buildRun(def, ctxRef.current, opts);
            const wasOpen = panelOpenRef.current;
            helpPanel.close();
            if (id === 'welcome') persist({ welcome_offered: true });
            // Con el panel abierto, se espera a que termine de cerrarse (si no,
            // su velo queda un instante debajo del primer paso).
            window.setTimeout(() => tourStore.start({ tourId: id, title: fillAppName(def.title, ctxRef.current.appName), meta, steps }), wasOpen ? 220 : 0);
            return true;
        },
        [hasTour, persist],
    );

    const openHelp = useCallback((opts?: { guideId?: string; query?: string }) => {
        helpPanel.open(opts);
    }, []);

    // Se re-registra cuando cambia lo que decide qué recorridos aplican: así
    // `useHasTour` en las otras piezas se re-evalúa solo.
    useEffect(() => registerHelpHandlers({ startTour, hasTour, openHelp }), [startTour, hasTour, openHelp, ctx]);

    // Al cambiar de empresa (el árbol se remonta) o cerrar sesión, nada queda
    // abierto de la anterior.
    useEffect(
        () => () => {
            tourStore.stop();
            helpPanel.close();
        },
        [],
    );

    const onFinish = useCallback(
        (tourId: string, outcome: TourOutcome, shown: number) => {
            if (outcome === 'completed') {
                // Sin ningún paso a la vista no se marca como hecho (el cierre ya
                // lo explicó): queda para cuando haya algo que mostrar.
                if (shown > 0) persist({ completed: [tourId] });
            } else {
                persist({ dismissed: [tourId] });
            }
        },
        [persist],
    );

    return (
        <>
            <TourLayer onFinish={onFinish} />
            {!viewer.isGuest && <WelcomeOffer listsReady={lists.isSuccess} listCount={lists.data?.length ?? 0} onStart={() => startTour('welcome', { skipIntro: true })} />}
            {!viewer.isGuest && <InstallOffer disabled={viewer.impersonating} />}
            {panel.open && (
                <Suspense fallback={null}>
                    <HelpPanel onShowShortcuts={onShowShortcuts} firstListSlug={ctx.firstList?.slug ?? null} appName={ctx.appName} />
                </Suspense>
            )}
        </>
    );
}
