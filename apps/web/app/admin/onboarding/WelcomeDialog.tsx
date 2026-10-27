import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { OnboardingApplyResult } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { WelcomeFlow, type WelcomePath } from './WelcomeFlow';

interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    initialPath?: WelcomePath;
    onCreated: (res: OnboardingApplyResult) => void;
}

/**
 * La bienvenida otra vez, ya con listas: «Agrega más con IA» desde
 * «Primeros pasos». Lo nuevo se crea aparte y no toca nada de lo que existe.
 * En el teléfono ocupa la pantalla entera.
 */
export function WelcomeDialog({ open, onOpenChange, initialPath = 'choose', onCreated }: Props): JSX.Element {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm imcrm-animate-imcrm-fade-in" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-flex imcrm-flex-col imcrm-bg-background',
                        'sm:imcrm-inset-auto sm:imcrm-left-1/2 sm:imcrm-top-1/2 sm:imcrm-h-auto sm:imcrm-max-h-[90vh] sm:imcrm-w-[calc(100%-2rem)] sm:imcrm-max-w-6xl sm:-imcrm-translate-x-1/2 sm:-imcrm-translate-y-1/2 sm:imcrm-rounded-xl sm:imcrm-border sm:imcrm-border-border sm:imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="welcome-dialog"
                >
                    <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-py-2.5">
                        <Dialog.Title className="imcrm-text-sm imcrm-font-semibold">{__('Agrega más a tu espacio')}</Dialog.Title>
                        <Dialog.Description className="imcrm-sr-only">
                            {__('Arma listas nuevas con IA o con plantillas, sin tocar lo que ya tienes.')}
                        </Dialog.Description>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>
                    <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-p-4 sm:imcrm-p-6">
                        <WelcomeFlow
                            variant="dialog"
                            initialPath={initialPath}
                            onCreated={(res) => {
                                onOpenChange(false);
                                onCreated(res);
                            }}
                        />
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
