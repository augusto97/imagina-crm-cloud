import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { FolderPlus } from 'lucide-react';
import { AUTOMATION_FOLDER_MAX_LENGTH } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * v0.1.411 — Pedir el nombre de una carpeta nueva (desde la barra, el menú
 * «Mover a carpeta» o la selección). El error del servidor —un nombre que ya
 * existe— se muestra adentro, sin cerrar.
 */
export function FolderNameDialog({
    open,
    title,
    description,
    confirmLabel,
    pending,
    error,
    onOpenChange,
    onSubmit,
}: {
    open: boolean;
    title: string;
    description?: string;
    confirmLabel: string;
    pending: boolean;
    error: string | null;
    onOpenChange: (open: boolean) => void;
    onSubmit: (name: string) => void;
}): JSX.Element {
    const [name, setName] = useState('');
    useEffect(() => {
        if (open) setName('');
    }, [open]);
    const clean = name.trim();

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-[99990] imcrm-bg-black/40 imcrm-backdrop-blur-sm imcrm-animate-in imcrm-fade-in" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-[99991] imcrm-w-[calc(100%-2rem)] imcrm-max-w-sm',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-xl',
                        'imcrm-animate-in imcrm-fade-in imcrm-zoom-in-95',
                    )}
                    data-testid="automation-folder-dialog"
                >
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            if (clean !== '' && !pending) onSubmit(clean);
                        }}
                        className="imcrm-flex imcrm-flex-col imcrm-gap-4"
                    >
                        <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                            <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary">
                                <FolderPlus className="imcrm-h-4 imcrm-w-4" />
                            </span>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                                <Dialog.Title className="imcrm-text-base imcrm-font-semibold">{title}</Dialog.Title>
                                {description && (
                                    <Dialog.Description className="imcrm-text-sm imcrm-leading-relaxed imcrm-text-muted-foreground">
                                        {description}
                                    </Dialog.Description>
                                )}
                            </div>
                        </div>
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Input
                                autoFocus
                                value={name}
                                maxLength={AUTOMATION_FOLDER_MAX_LENGTH}
                                placeholder={__('Ej.: Cobros, Avisos al equipo, WhatsApp')}
                                onChange={(e) => setName(e.target.value)}
                                data-testid="automation-folder-name"
                            />
                            {error && <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>}
                        </div>
                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2">
                            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                                {__('Cancelar')}
                            </Button>
                            <Button type="submit" size="sm" disabled={clean === '' || pending} data-testid="automation-folder-save">
                                {confirmLabel}
                            </Button>
                        </div>
                    </form>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
