import * as Dialog from '@radix-ui/react-dialog';
import { ScanLine, X } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * H3 — El marco de los escáneres: en el celular ocupa TODA la pantalla (la
 * cámara necesita lugar y una mano libre), en el escritorio es un diálogo
 * centrado. El contenido (cámara + resultados) lo pone cada uso.
 */
export function ScanDialog({
    open,
    onOpenChange,
    title,
    description,
    children,
    testId,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    children: React.ReactNode;
    testId?: string;
}): JSX.Element {
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/50 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    data-testid={testId}
                    className={cn(
                        'imcrm-fixed imcrm-z-50 imcrm-flex imcrm-flex-col imcrm-bg-card imcrm-shadow-imcrm-lg',
                        // Celular: pantalla completa (con el alto real de la ventana).
                        'imcrm-inset-0 imcrm-h-[100dvh] imcrm-w-full',
                        // Escritorio: diálogo centrado.
                        'sm:imcrm-inset-auto sm:imcrm-left-1/2 sm:imcrm-top-1/2 sm:imcrm-h-auto sm:imcrm-max-h-[92vh] sm:imcrm-w-[calc(100%-2rem)] sm:imcrm-max-w-lg sm:imcrm--translate-x-1/2 sm:imcrm--translate-y-1/2 sm:imcrm-rounded-lg sm:imcrm-border sm:imcrm-border-border',
                    )}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-px-4 imcrm-py-3">
                        <div className="imcrm-flex imcrm-min-w-0 imcrm-items-start imcrm-gap-2.5">
                            <ScanLine className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                            <div className="imcrm-min-w-0">
                                <Dialog.Title className="imcrm-truncate imcrm-text-base imcrm-font-semibold">{title}</Dialog.Title>
                                {description ? (
                                    <Dialog.Description className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">{description}</Dialog.Description>
                                ) : (
                                    <Dialog.Description className="imcrm-sr-only">{__('Escáner de códigos QR y de barras')}</Dialog.Description>
                                )}
                            </div>
                        </div>
                        <Dialog.Close asChild>
                            <button
                                type="button"
                                aria-label={__('Cerrar')}
                                className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent"
                            >
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </button>
                        </Dialog.Close>
                    </div>
                    <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-p-4">{children}</div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
