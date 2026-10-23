import { CalendarClock, ExternalLink, Lock, MoreHorizontal } from 'lucide-react';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import type { CalendarEvent } from './calendarModel';

/**
 * El «…» de un evento: abrir el registro y «Mover a…» (cambiar el día, la
 * hora y el fin sin arrastrar — en el celular es la forma de reprogramar).
 * Si el evento no se puede mover, el motivo va en el menú.
 */
export function CalendarEventMenu({
    event,
    onOpen,
    onMoveTo,
    lockedReason,
    className,
}: {
    event: CalendarEvent;
    onOpen: (event: CalendarEvent) => void;
    /** undefined = no se puede mover (sin permiso o bloqueado). */
    onMoveTo?: (event: CalendarEvent) => void;
    lockedReason?: string | null;
    className?: string;
}): JSX.Element {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={__('Acciones del evento')}
                    data-testid="imcrm-cal-event-menu"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    className={cn(
                        'imcrm-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground',
                        className,
                    )}
                >
                    <MoreHorizontal className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="imcrm-w-56">
                <DropdownMenuLabel className="imcrm-truncate">{event.title}</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => onOpen(event)}>
                    <ExternalLink className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" aria-hidden />
                    {__('Abrir')}
                </DropdownMenuItem>
                {onMoveTo ? (
                    <DropdownMenuItem onSelect={() => onMoveTo(event)} data-testid="imcrm-cal-move-to">
                        <CalendarClock className="imcrm-mr-2 imcrm-h-4 imcrm-w-4" aria-hidden />
                        {__('Mover a…')}
                    </DropdownMenuItem>
                ) : lockedReason ? (
                    <>
                        <DropdownMenuSeparator />
                        <p className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-text-muted-foreground">
                            <Lock className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" aria-hidden />
                            {lockedReason}
                        </p>
                    </>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
