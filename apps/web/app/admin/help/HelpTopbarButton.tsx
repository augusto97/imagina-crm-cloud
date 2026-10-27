import { CircleHelp } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { help, useHelpAvailability } from './helpBus';
import { helpPanel, useHelpPanel } from './helpPanelStore';

/**
 * Fase 7 · entrega 2 — el botón «Ayuda» de la barra superior (a la derecha de
 * la campana). En el teléfono no entra: ahí la ayuda vive en el menú de la
 * persona (`HelpMenuItem`). Sólo se dibuja si el centro de ayuda está montado.
 */
export function HelpTopbarButton({ className }: { className?: string }): JSX.Element | null {
    const { help: available } = useHelpAvailability();
    const panel = useHelpPanel();
    if (!available) return null;
    return (
        <Button
            variant="ghost"
            size="icon"
            aria-label={__('Ayuda')}
            title={__('Ayuda')}
            aria-pressed={panel.open}
            data-testid="topbar-help"
            data-tour="topbar-help"
            className={cn('imcrm-hidden imcrm-text-foreground sm:imcrm-inline-flex', panel.open && 'imcrm-bg-accent', className)}
            onClick={() => (panel.open ? helpPanel.close() : help.openHelp())}
        >
            <CircleHelp className="imcrm-h-4 imcrm-w-4" />
        </Button>
    );
}

/** «Ayuda» en el menú de la persona (en el teléfono es la única entrada). */
export function HelpMenuItem(): JSX.Element | null {
    const { help: available } = useHelpAvailability();
    if (!available) return null;
    return (
        <DropdownMenuItem
            // Se abre cuando el menú termina de cerrarse (si no, el menú le
            // devuelve el foco a su botón y le saca el foco al panel).
            onSelect={() => window.setTimeout(() => help.openHelp(), 0)}
            data-testid="user-menu-help"
        >
            <CircleHelp className="imcrm-h-4 imcrm-w-4" />
            {__('Ayuda')}
        </DropdownMenuItem>
    );
}
