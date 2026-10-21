import * as Dialog from '@radix-ui/react-dialog';
import { Keyboard, X } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { GO_CHORDS, PALETTE_SHORTCUT_LABEL } from '@/lib/shortcuts';

/**
 * v0.1.286 — ayuda de atajos de teclado (tecla `?` o el menú de la persona).
 */
export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }): JSX.Element {
    const rows: Array<{ keys: string[]; label: string }> = [
        { keys: [PALETTE_SHORTCUT_LABEL], label: __('Buscar y abrir cualquier cosa') },
        { keys: ['?'], label: __('Mostrar estos atajos') },
        ...GO_CHORDS.map((c) => ({ keys: ['g', c.key], label: __(c.label) })),
        { keys: ['Esc'], label: __('Cerrar un panel o diálogo') },
    ];
    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40" />
                <Dialog.Content
                    data-testid="shortcuts-dialog"
                    className="imcrm-fixed imcrm-left-1/2 imcrm-top-[15vh] imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md imcrm--translate-x-1/2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-lg"
                >
                    <div className="imcrm-mb-3 imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                        <Dialog.Title className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                            <Keyboard className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                            {__('Atajos de teclado')}
                        </Dialog.Title>
                        <Dialog.Close
                            aria-label={__('Cerrar')}
                            className="imcrm-inline-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                        >
                            <X className="imcrm-h-4 imcrm-w-4" />
                        </Dialog.Close>
                    </div>
                    <Dialog.Description className="imcrm-mb-3 imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Los atajos de una sola tecla no funcionan mientras escribes en un campo.')}
                    </Dialog.Description>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border">
                        {rows.map((r) => (
                            <li key={r.label} className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-py-2 imcrm-text-sm">
                                <span>{r.label}</span>
                                <span className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-1">
                                    {r.keys.map((k, i) => (
                                        <span key={`${k}-${i}`} className="imcrm-flex imcrm-items-center imcrm-gap-1">
                                            {i > 0 && <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('luego')}</span>}
                                            <kbd className="imcrm-min-w-[1.5rem] imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-text-center imcrm-text-[11px] imcrm-font-medium">
                                                {k}
                                            </kbd>
                                        </span>
                                    ))}
                                </span>
                            </li>
                        ))}
                    </ul>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
