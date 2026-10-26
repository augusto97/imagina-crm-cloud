import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { AssistantPanel } from '@/admin/assistant/AssistantPanel';
import { EmailVerifyBanner } from '@/admin/layout/EmailVerifyBanner';
import { GlobalCommandPalette } from '@/admin/layout/GlobalCommandPalette';
import { ImpersonationBanner } from '@/admin/layout/ImpersonationBanner';
import { ListCreateDialog } from '@/admin/lists/ListCreateDialog';
import { ActivePathSync } from './activePath';
import { RouteTracker } from './RouteTracker';
import { ShortcutsDialog } from './ShortcutsDialog';
import { Sidebar } from '@/admin/layout/Sidebar';
import { SkipLink } from '@/admin/layout/SkipLink';
import { Topbar } from '@/admin/layout/Topbar';
import { __ } from '@/lib/i18n';
import { lazyWithReload } from '@/lib/lazyWithReload';
import { CHORD_TIMEOUT_MS, isTypingTarget, resolveGoChord } from '@/lib/shortcuts';

const GlobalScanDialog = lazyWithReload(() => import('@/admin/scan/GlobalScanDialog'));

export function AdminShell(): JSX.Element {
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [createListOpen, setCreateListOpen] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const [scanOpen, setScanOpen] = useState(false);
    const [paletteQuery, setPaletteQuery] = useState('');
    const location = useLocation();
    const navigate = useNavigate();

    // Cerrar el drawer del sidebar al navegar (mobile).
    useEffect(() => {
        setMobileNavOpen(false);
    }, [location.pathname]);

    // v0.1.169 — Escape cierra el drawer (teclado físico en tablet / lector
    // de pantalla). El velo tapa el contenido; el shell es h-screen con
    // overflow-hidden, así que no hay scroll de documento que bloquear.
    useEffect(() => {
        if (!mobileNavOpen) return;
        const onKey = (e: KeyboardEvent): void => {
            if (e.key === 'Escape') setMobileNavOpen(false);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [mobileNavOpen]);

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
        <div className="imcrm-flex imcrm-h-screen imcrm-min-h-screen imcrm-w-full imcrm-overflow-hidden imcrm-bg-background imcrm-text-foreground">
            <SkipLink />
            {/* Backdrop del drawer en mobile. */}
            {mobileNavOpen && (
                <div
                    className="imcrm-fixed imcrm-inset-0 imcrm-z-40 imcrm-bg-black/40 lg:imcrm-hidden"
                    aria-hidden
                    data-testid="imcrm-drawer-backdrop"
                    onClick={() => setMobileNavOpen(false)}
                />
            )}
            <ActivePathSync />
            <RouteTracker />
            <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                <ImpersonationBanner />
                <Topbar
                    onMenuClick={() => setMobileNavOpen(true)}
                    onSearchClick={openPalette}
                    onShowShortcuts={openShortcuts}
                />
                <EmailVerifyBanner />
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
        </div>
    );
}
