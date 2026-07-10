import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { GlobalCommandPalette } from '@/admin/layout/GlobalCommandPalette';
import { ImpersonationBanner } from '@/admin/layout/ImpersonationBanner';
import { Sidebar } from '@/admin/layout/Sidebar';
import { SkipLink } from '@/admin/layout/SkipLink';
import { Topbar } from '@/admin/layout/Topbar';
import { __ } from '@/lib/i18n';

export function AdminShell(): JSX.Element {
    const [paletteOpen, setPaletteOpen] = useState(false);
    const [mobileNavOpen, setMobileNavOpen] = useState(false);
    const location = useLocation();

    // Cerrar el drawer del sidebar al navegar (mobile).
    useEffect(() => {
        setMobileNavOpen(false);
    }, [location.pathname]);

    // Cmd/Ctrl+K abre el global command palette. Se desactiva
    // cuando estamos dentro del editor de plantilla (esa ruta tiene
    // su propio Cmd+K via EditorCommandPalette) o cuando el foco
    // está en un input editable (sino interferimos con la edición).
    // (Fase 15.A)
    const isInTemplateEditor = location.pathname.includes('/template-editor');

    useEffect(() => {
        if (isInTemplateEditor) return;

        const isEditableTarget = (target: EventTarget | null): boolean => {
            if (! (target instanceof HTMLElement)) return false;
            const tag = target.tagName;
            return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
        };

        const onKeyDown = (e: KeyboardEvent): void => {
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.key.toLowerCase() === 'k' && ! isEditableTarget(e.target)) {
                e.preventDefault();
                setPaletteOpen((v) => ! v);
            }
        };

        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [isInTemplateEditor]);

    return (
        <div className="imcrm-flex imcrm-h-screen imcrm-min-h-screen imcrm-w-full imcrm-overflow-hidden imcrm-bg-canvas imcrm-text-foreground">
            <SkipLink />
            {/* Backdrop del drawer en mobile. */}
            {mobileNavOpen && (
                <div
                    className="imcrm-fixed imcrm-inset-0 imcrm-z-40 imcrm-bg-black/40 lg:imcrm-hidden"
                    aria-hidden
                    onClick={() => setMobileNavOpen(false)}
                />
            )}
            <Sidebar mobileOpen={mobileNavOpen} onClose={() => setMobileNavOpen(false)} />
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                <ImpersonationBanner />
                <Topbar onMenuClick={() => setMobileNavOpen(true)} />
                <main
                    id="imcrm-main"
                    aria-label={__('Contenido principal')}
                    className="imcrm-flex-1 imcrm-overflow-auto imcrm-p-4 focus:imcrm-outline-none focus-visible:imcrm-outline-none sm:imcrm-p-6"
                    tabIndex={-1}
                >
                    <div className="imcrm-mx-auto imcrm-w-full imcrm-max-w-screen-2xl">
                        <Outlet />
                    </div>
                </main>
            </div>
            {! isInTemplateEditor && (
                <GlobalCommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
            )}
        </div>
    );
}
