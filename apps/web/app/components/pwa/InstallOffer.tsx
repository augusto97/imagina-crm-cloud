import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router';
import { Download, X } from 'lucide-react';

import { InstallAppDialog } from '@/components/pwa/InstallAppDialog';
import { screenIsBusy } from '@/admin/whats-new/featuredGate';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { __, sprintf } from '@/lib/i18n';
import { currentAppName } from '@/lib/pwa/appMeta';
import { promptInstall, useInstallMode } from '@/lib/pwa/install';
import { canOfferInstall, offerDue, readOfferMemory, rememberOffer } from '@/lib/pwa/installOffer';
import { browserName, deviceInfo } from '@/lib/pwa/platform';
import { cn } from '@/lib/utils';
import { useSession } from '@/cloud/session';

/** Cuánto esperar antes de ofrecerla: que la pantalla cargue y el navegador avise si puede instalar. */
export const INSTALL_OFFER_DELAY_MS = 6000;

/** Pantallas tranquilas (no en un editor a pantalla completa ni a mitad de un alta). */
function isCalmRoute(pathname: string): boolean {
    return (
        pathname === '/lists' ||
        /^\/lists\/[^/]+\/records$/.test(pathname) ||
        pathname === '/my-work' ||
        pathname === '/favorites' ||
        pathname === '/dashboards' ||
        pathname === '/novedades' ||
        /^\/dashboards\/[^/]+$/.test(pathname) ||
        /^\/folders\/[^/]+$/.test(pathname)
    );
}

/** Subir la tarjeta para no tapar el botón de «Primeros pasos» (misma esquina). */
function offsetAboveGettingStarted(): number | null {
    const pill = document.querySelector('[data-tour="getting-started"]');
    if (!(pill instanceof HTMLElement)) return null;
    const rect = pill.getBoundingClientRect();
    if (rect.height === 0) return null;
    return Math.max(0, Math.round(window.innerHeight - rect.top + 12));
}

/**
 * v0.1.326 — «Instala la app en este dispositivo», la primera vez que se usa
 * en cada dispositivo (reglas en `lib/pwa/installOffer`). Con la ventana del
 * navegador, «Instalar» la abre; sin ella, muestra los pasos de este
 * navegador. Nunca encima de otra cosa (un diálogo, un recorrido, la
 * bienvenida, un campo donde se escribe) ni durante una impersonación.
 */
export function InstallOffer({ disabled = false }: { disabled?: boolean }): JSX.Element | null {
    const mode = useInstallMode();
    // v0.1.327 — el ícono con el que se instala aquí (el de la plataforma si lo subió).
    const appIcon = useSession((s) => (s.domainTenant ? null : s.platformBrand.icons?.icon_96)) ?? '/pwa/icon-96.png';
    const { pathname } = useLocation();
    const narrow = useMediaQuery('(max-width: 639px)');
    const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
    const [ready, setReady] = useState(false);
    const [open, setOpen] = useState(false);
    const [closed, setClosed] = useState(false);
    const [steps, setSteps] = useState(false);
    const [bottom, setBottom] = useState<number | null>(null);

    useEffect(() => {
        const t = window.setTimeout(() => setReady(true), INSTALL_OFFER_DELAY_MS);
        return () => window.clearTimeout(t);
    }, []);

    const eligible = !disabled && ready && !closed && !open && isCalmRoute(pathname) && canOfferInstall(mode, deviceInfo(), browserName());

    // Espera a un momento tranquilo (se mira cada segundo) y la presenta UNA vez.
    useEffect(() => {
        if (!eligible) return;
        const check = (): void => {
            if (screenIsBusy()) return;
            const memory = readOfferMemory();
            if (!offerDue(memory, Date.now())) {
                setClosed(true);
                return;
            }
            rememberOffer(memory, Date.now(), 'shown');
            setBottom(offsetAboveGettingStarted());
            setOpen(true);
        };
        check();
        const t = window.setInterval(check, 1000);
        return () => window.clearInterval(t);
    }, [eligible]);

    // Si se instaló por otro lado (el ícono del navegador), no se vuelve a ofrecer.
    useEffect(() => {
        if (mode === null && open) {
            rememberOffer(readOfferMemory(), Date.now(), 'installed');
            setOpen(false);
            setClosed(true);
        }
    }, [mode, open]);

    const appName = currentAppName();
    const close = (): void => {
        setOpen(false);
        setClosed(true);
    };
    const install = (): void => {
        if (mode === 'prompt') {
            void promptInstall().then((ok) => {
                if (ok) rememberOffer(readOfferMemory(), Date.now(), 'installed');
            });
            close();
            return;
        }
        setOpen(false);
        setClosed(true);
        setSteps(true);
    };

    return (
        <>
            {steps && (
                <InstallAppDialog
                    open={steps}
                    onOpenChange={setSteps}
                    appName={appName}
                    onInstalled={() => rememberOffer(readOfferMemory(), Date.now(), 'installed')}
                />
            )}
            {open &&
                createPortal(
                    <div
                        role="dialog"
                        aria-modal="false"
                        aria-labelledby="imcrm-install-offer-title"
                        aria-describedby="imcrm-install-offer-body"
                        data-testid="install-offer"
                        data-help-overlay=""
                        style={bottom !== null ? { bottom } : undefined}
                        className={cn(
                            'imcrm-fixed imcrm-z-[45] imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 imcrm-text-card-foreground imcrm-shadow-imcrm-xl',
                            narrow ? 'imcrm-inset-x-3 imcrm-bottom-3' : 'imcrm-bottom-5 imcrm-right-5 imcrm-w-[340px]',
                            !reducedMotion && 'imcrm-animate-imcrm-fade-in',
                        )}
                    >
                        <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                            <img src={appIcon} alt="" aria-hidden className="imcrm-h-10 imcrm-w-10 imcrm-shrink-0 imcrm-rounded-xl" />
                            <div className="imcrm-min-w-0 imcrm-flex-1">
                                <h2 id="imcrm-install-offer-title" className="imcrm-text-[15px] imcrm-font-semibold imcrm-leading-snug">
                                    {narrow ? __('Instala la app en tu teléfono') : __('Instala la app en este equipo')}
                                </h2>
                                <p id="imcrm-install-offer-body" className="imcrm-mt-1 imcrm-text-[13px] imcrm-leading-relaxed imcrm-text-muted-foreground">
                                    {sprintf(
                                        __('Abre %s desde su ícono, en su propia ventana, y recibe avisos aunque esté cerrada.'),
                                        appName,
                                    )}
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={close}
                                aria-label={__('Cerrar')}
                                className="imcrm-inline-flex imcrm-h-7 imcrm-w-7 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                            >
                                <X className="imcrm-h-4 imcrm-w-4" aria-hidden />
                            </button>
                        </div>
                        <div className="imcrm-flex imcrm-items-center imcrm-justify-end imcrm-gap-2">
                            {!narrow && <span className="imcrm-mr-auto imcrm-text-[11px] imcrm-text-muted-foreground">{__('También está en tu menú.')}</span>}
                            <button
                                type="button"
                                onClick={close}
                                data-testid="install-offer-later"
                                className="imcrm-inline-flex imcrm-h-8 imcrm-items-center imcrm-rounded-md imcrm-px-3 imcrm-text-[13px] imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                            >
                                {__('Ahora no')}
                            </button>
                            <button
                                type="button"
                                onClick={install}
                                data-testid="install-offer-install"
                                className="imcrm-inline-flex imcrm-h-8 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-bg-primary imcrm-px-3 imcrm-text-[13px] imcrm-font-medium imcrm-text-primary-foreground hover:imcrm-bg-primary/90 focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40"
                            >
                                <Download className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                {mode === 'prompt' ? __('Instalar') : __('Ver cómo')}
                            </button>
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
}
