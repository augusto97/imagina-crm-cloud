import * as Dialog from '@radix-ui/react-dialog';
import { PlusSquare, Share, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';
import { deviceInfo } from '@/lib/pwa/platform';
import { cn } from '@/lib/utils';

/**
 * H1 — Cómo instalar la app en iPhone/iPad: Safari no avisa que se puede
 * instalar (no hay `beforeinstallprompt`), se hace desde su menú Compartir.
 * También explica que en iOS las notificaciones push SÓLO funcionan con la
 * app instalada en la pantalla de inicio.
 */
export function InstallAppDialog({
    open,
    onOpenChange,
    appName,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    appName: string;
}): JSX.Element {
    const info = deviceInfo();
    const notSafari = info.ios && !info.iosSafari;
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    data-testid="install-ios-dialog"
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-sm',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg',
                    )}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{__('Instalar la app')}</Dialog.Title>
                        <Dialog.Close asChild>
                            <button type="button" aria-label={__('Cerrar')} className="imcrm-rounded-md imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent">
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </button>
                        </Dialog.Close>
                    </div>
                    <Dialog.Description className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                        {`${appName}: `}
                        {__('queda en la pantalla de inicio y se abre a pantalla completa, como cualquier app.')}
                    </Dialog.Description>
                    {notSafari && (
                        <p className="imcrm-mt-3 imcrm-rounded-md imcrm-bg-warning/15 imcrm-px-3 imcrm-py-2 imcrm-text-xs">
                            {__('En iPhone y iPad se instala desde Safari: abre esta misma dirección en Safari y sigue los pasos.')}
                        </p>
                    )}
                    <ol className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-text-sm">
                        <li className="imcrm-flex imcrm-items-start imcrm-gap-3">
                            <span className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-xs imcrm-font-semibold">1</span>
                            <span>
                                {__('Toca el botón')} <Share className="imcrm-mx-0.5 imcrm-inline imcrm-h-4 imcrm-w-4 imcrm-align-text-bottom" aria-label={__('Compartir')} />{' '}
                                <strong>{__('Compartir')}</strong> {__('de Safari (abajo en el iPhone, arriba en el iPad).')}
                            </span>
                        </li>
                        <li className="imcrm-flex imcrm-items-start imcrm-gap-3">
                            <span className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-xs imcrm-font-semibold">2</span>
                            <span>
                                {__('Elige')} <PlusSquare className="imcrm-mx-0.5 imcrm-inline imcrm-h-4 imcrm-w-4 imcrm-align-text-bottom" aria-hidden />{' '}
                                <strong>{__('Agregar a inicio')}</strong> {__('(si no lo ves, desliza la lista hacia abajo).')}
                            </span>
                        </li>
                        <li className="imcrm-flex imcrm-items-start imcrm-gap-3">
                            <span className="imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-xs imcrm-font-semibold">3</span>
                            <span>
                                {__('Toca')} <strong>{__('Agregar')}</strong>. {__('Abre la app desde el icono nuevo.')}
                            </span>
                        </li>
                    </ol>
                    <p className="imcrm-mt-4 imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Las notificaciones en el iPhone y el iPad sólo funcionan con la app instalada así, en iOS 16.4 o más nuevo. Después actívalas en Ajustes → Cuenta → Avisos, desde la app instalada.')}
                    </p>
                    <div className="imcrm-mt-4 imcrm-flex imcrm-justify-end">
                        <Dialog.Close asChild>
                            <Button size="sm">{__('Entendido')}</Button>
                        </Dialog.Close>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
