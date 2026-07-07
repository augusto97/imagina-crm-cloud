import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { TriangleAlert } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Reemplazo in-app de `window.confirm`. Devuelve un `Promise<boolean>`
 * — resuelve `true` si el usuario confirma, `false` si cancela o
 * cierra el dialog.
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: '¿Eliminar?', description: '...' })) {
 *       await del();
 *   }
 *
 * Una sola instancia activa a la vez (es lo que el user espera de un
 * confirm modal). Llamadas concurrentes encolan: la segunda promise
 * resuelve cuando la primera cierra.
 */

export interface ConfirmOptions {
    title: string;
    description?: string;
    /** Default: "Confirmar". */
    confirmLabel?: string;
    /** Default: "Cancelar". */
    cancelLabel?: string;
    /** Si true, el botón de confirmar es rojo (delete-like). */
    destructive?: boolean;
}

interface ConfirmContextValue {
    confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

interface QueueItem extends ConfirmOptions {
    resolve: (ok: boolean) => void;
}

export function ConfirmProvider({ children }: { children: React.ReactNode }): JSX.Element {
    const [queue, setQueue] = useState<QueueItem[]>([]);
    const current = queue[0] ?? null;

    const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
        return new Promise<boolean>((resolve) => {
            setQueue((prev) => [...prev, { ...options, resolve }]);
        });
    }, []);

    const handleResult = useCallback((ok: boolean) => {
        setQueue((prev) => {
            if (prev.length === 0) return prev;
            const [head, ...rest] = prev;
            head!.resolve(ok);
            return rest;
        });
    }, []);

    const value = useMemo<ConfirmContextValue>(() => ({ confirm }), [confirm]);

    return (
        <ConfirmContext.Provider value={value}>
            {children}
            <Dialog.Root
                open={current !== null}
                onOpenChange={(open) => {
                    if (! open && current !== null) handleResult(false);
                }}
            >
                {current !== null && (
                    <Dialog.Portal>
                        <Dialog.Overlay
                            className="imcrm-fixed imcrm-inset-0 imcrm-z-[99990] imcrm-bg-black/40 imcrm-backdrop-blur-sm imcrm-animate-in imcrm-fade-in"
                        />
                        <Dialog.Content
                            className={cn(
                                'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-[99991] imcrm-w-full imcrm-max-w-md',
                                'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                                'imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-xl',
                                'imcrm-animate-in imcrm-fade-in imcrm-zoom-in-95',
                            )}
                            onEscapeKeyDown={() => handleResult(false)}
                        >
                            <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                                {current.destructive && (
                                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-destructive/10">
                                        <TriangleAlert className="imcrm-h-5 imcrm-w-5 imcrm-text-destructive" />
                                    </span>
                                )}
                                <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1">
                                    <Dialog.Title className="imcrm-text-base imcrm-font-semibold imcrm-text-foreground">
                                        {current.title}
                                    </Dialog.Title>
                                    {current.description && (
                                        <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground imcrm-leading-relaxed">
                                            {current.description}
                                        </Dialog.Description>
                                    )}
                                </div>
                            </div>

                            <div className="imcrm-mt-5 imcrm-flex imcrm-justify-end imcrm-gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => handleResult(false)}
                                >
                                    {current.cancelLabel ?? __('Cancelar')}
                                </Button>
                                <Button
                                    variant={current.destructive ? 'destructive' : 'default'}
                                    size="sm"
                                    onClick={() => handleResult(true)}
                                    autoFocus
                                >
                                    {current.confirmLabel ?? __('Confirmar')}
                                </Button>
                            </div>
                        </Dialog.Content>
                    </Dialog.Portal>
                )}
            </Dialog.Root>
        </ConfirmContext.Provider>
    );
}

export function useConfirm(): ConfirmContextValue['confirm'] {
    const ctx = useContext(ConfirmContext);
    if (! ctx) {
        throw new Error('useConfirm debe usarse dentro de <ConfirmProvider>');
    }
    return ctx.confirm;
}
