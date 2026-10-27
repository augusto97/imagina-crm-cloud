import * as Dialog from '@radix-ui/react-dialog';
import { Download, X } from 'lucide-react';

import { InstallSteps } from '@/components/pwa/InstallSteps';
import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';
import { promptInstall, useInstallMode } from '@/lib/pwa/install';
import { cn } from '@/lib/utils';

/**
 * H1 / v0.1.321 — «Instalar la app» cuando el navegador no ofrece su propia
 * ventana: los pasos para ESTE navegador (iPhone, Android, Chrome, Edge,
 * Safari en el Mac; en Firefox, que no instala, qué usar en su lugar), con un
 * selector para ver los de otro dispositivo. Si mientras está abierto el
 * navegador avisa que ya se puede instalar, aparece «Instalar ahora».
 */
export function InstallAppDialog({
    open,
    onOpenChange,
    appName,
    onInstalled,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    appName: string;
    onInstalled?: () => void;
}): JSX.Element {
    const mode = useInstallMode();
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    data-testid="install-dialog"
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-max-h-[calc(100dvh-1.5rem)] imcrm-overflow-y-auto',
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
                        {__('queda en tu pantalla de inicio o con tus aplicaciones, se abre en su propia ventana y te avisa con notificaciones aunque esté cerrada.')}
                    </Dialog.Description>

                    {mode === 'prompt' && (
                        <Button
                            type="button"
                            className="imcrm-mt-4"
                            data-testid="install-now"
                            onClick={() =>
                                void promptInstall().then((ok) => {
                                    if (ok) {
                                        onInstalled?.();
                                        onOpenChange(false);
                                    }
                                })
                            }
                        >
                            <Download className="imcrm-h-4 imcrm-w-4" />
                            {__('Instalar ahora')}
                        </Button>
                    )}

                    <InstallSteps className="imcrm-mt-4" />

                    <div className="imcrm-mt-4 imcrm-flex imcrm-justify-end">
                        <Dialog.Close asChild>
                            <Button size="sm" variant={mode === 'prompt' ? 'outline' : 'default'}>
                                {__('Entendido')}
                            </Button>
                        </Dialog.Close>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
