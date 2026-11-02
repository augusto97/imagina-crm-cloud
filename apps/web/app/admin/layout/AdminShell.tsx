import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate } from 'react-router';

import { AssistantPanel } from '@/admin/assistant/AssistantPanel';
import { AccessBanner } from '@/admin/layout/AccessBanner';
import { EmailVerifyBanner } from '@/admin/layout/EmailVerifyBanner';
import { GlobalCommandPalette } from '@/admin/layout/GlobalCommandPalette';
import { ImpersonationBanner } from '@/admin/layout/ImpersonationBanner';
import { ListCreateDialog } from '@/admin/lists/ListCreateDialog';
import { GettingStarted } from '@/admin/onboarding/GettingStarted';
import { ActivePathSync } from './activePath';
import { RouteTracker } from './RouteTracker';
import { ShortcutsDialog } from './ShortcutsDialog';
import { MobileTabBar } from '@/admin/layout/MobileTabBar';
import { Sidebar } from '@/admin/layout/Sidebar';
import { SkipLink } from '@/admin/layout/SkipLink';
import { Topbar } from '@/admin/layout/Topbar';
import { WhatsNewHost } from '@/admin/whats-new/WhatsNewHost';
import { WhatsNewNoticeBanner } from '@/admin/whats-new/WhatsNewNoticeBanner';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { __ } from '@/lib/i18n';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { CHORD_TIMEOUT_MS, isTypingTarget, resolveGoChord } from '@/lib/shortcuts';

const GlobalScanDialog = lazyWithReload(() => import('@/admin/scan/GlobalScanDialog'));
// Fase 7 — centro de ayuda y recorridos (chunk propio: no pesa en la carga inicial).
const HelpCenter = lazyWithReload(() => import('@/admin/help/HelpCenter').then((m) => ({ default: m.HelpCenter })));

export function AdminShell(): JSX.Element {
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [createListOpen, setCreateListOpen] = useState(false);
    const [scanOpen, setScanOpen] = useState(false);
    const [paletteQuery, setPaletteQuery] = useState('');
    const navigate = useNavigate();
    // v0.1.342 — el riel + panel es del escritorio. Bajo 1024 px manda la
    // barra de pestañas de abajo (Listas · Mi trabajo · Buscar · Avisos · Más),
    // como en las apps del teléfono: antes había que abrir un cajón de dos
    // columnas para cualquier cosa. El Sidebar ni se monta en el celular.
    const isDesktop = useMediaQuery('(min-width: 1024px)');

    // Atajos globales (v0.1.286):
    //  - Ctrl/⌘+K abre la paleta desde CUALQUIER lugar, también con el foco en
    //    un campo (antes se ignoraba ahí: justo donde más se está).
    //  - `?` muestra la ayuda; `g` + letra va a una sección. Estos, de una sola
    //    tecla, se ignoran mientras se escribe o con un diálogo abierto.
    const pendingG = useRef<number | null>(null);
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent): void => {
            const mod = e.metaKey || e.ctrlKey;
            if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setPaletteOpen((v) => !v);
                return;
            }
            if (e.defaultPrevented || mod || e.altKey || e.repeat) return;
            if (isTypingTarget(e.target)) return;
            if (document.querySelector('[role="dialog"][data-state="open"], [role="menu"][data-state="open"]')) return;
            const now = Date.now();
            const gWindow = pendingG.current !== null && now - pendingG.current < CHORD_TIMEOUT_MS;
            if (gWindow) {
                pendingG.current = null;
                const path = resolveGoChord(true, e.key);
                if (path) {
                    e.preventDefault();
                    navigate(path);
                }
                return;
            }
            if (e.key === '?') {
                e.preventDefault();
                setShortcutsOpen(true);
                return;
            }
            if (e.key === 'g') pendingG.current = now;
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [navigate]);

    const openPalette = useCallback(() => setPaletteOpen(true), []);
    const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
    const openCreateList = useCallback(() => setCreateListOpen(true), []);
    const openScan = useCallback(() => setScanOpen(true), []);

    return (
        // `imcrm-app-height` = 100dvh (con 100vh de respaldo): en Safari del
        // iPhone 100vh es MÁS alto que lo visible y la barra de abajo quedaba
        // tapada por la del navegador. Los rellenos `safe-area` respetan la
        // muesca y la barra del inicio en la app instalada (viewport-fit=cover).
        <div className="imcrm-app-shell imcrm-flex imcrm-app-height imcrm-w-full imcrm-overflow-hidden imcrm-bg-background imcrm-text-foreground">
            <SkipLink />
            <ActivePathSync />
            <RouteTracker />
            {isDesktop && <Sidebar />}
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                <ImpersonationBanner />
                <Topbar onSearchClick={openPalette} onShowShortcuts={openShortcuts} />
                <AccessBanner />
                <EmailVerifyBanner />
                {/* Fase 7 — avisos de la plataforma (mantenimiento, etc.). */}
                <WhatsNewNoticeBanner />
                <main
                    id="imcrm-main"
                    aria-label={__('Contenido principal')}
                    className="imcrm-flex-1 imcrm-overflow-auto imcrm-px-3 imcrm-py-2 focus:imcrm-outline-none focus-visible:imcrm-outline-none sm:imcrm-px-4 sm:imcrm-py-2"
                    tabIndex={-1}
                >
                    {/* v0.1.261 — sin ancho máximo: el área de trabajo ocupa toda
                        la ventana, como ClickUp (las páginas de formularios
                        —Ajustes, sincronizaciones— ponen su propio tope). */}
                    <div className="imcrm-w-full">
                        <Outlet />
                    </div>
                </main>
                <MobileTabBar onSearch={openPalette} />
            </div>
            <GlobalCommandPalette
                open={paletteOpen}
                onOpenChange={(o) => {
                    setPaletteOpen(o);
                    if (!o) setPaletteQuery('');
                }}
                onCreateList={openCreateList}
                onShowShortcuts={openShortcuts}
                onScan={openScan}
                initialQuery={paletteQuery}
            />
            {/* H3 — escáner de la búsqueda global (se carga a pedido). */}
            {scanOpen && (
                <Suspense fallback={null}>
                    <GlobalScanDialog
                        open={scanOpen}
                        onOpenChange={setScanOpen}
                        onSearchAsText={(code) => {
                            setScanOpen(false);
                            setPaletteQuery(code);
                            setPaletteOpen(true);
                        }}
                    />
                </Suspense>
            )}
            {shortcutsOpen && <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />}
            {createListOpen && <ListCreateDialog open={createListOpen} onOpenChange={setCreateListOpen} />}
            {/* v0.1.181 — asistente IA (ADR-S21): drawer a la derecha, se abre desde el Topbar. */}
            <AssistantPanel />
            {/* F7 (ADR-S72) — «Primeros pasos»: widget flotante abajo a la derecha. */}
            <GettingStarted onCreateList={openCreateList} />
            {/* Fase 7 — panel de Novedades y diálogo de destacadas. */}
            <WhatsNewHost />
            <Suspense fallback={null}>
                <HelpCenter onShowShortcuts={openShortcuts} />
            </Suspense>
        </div>
    );
}
