import { memo, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { EyeOff, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';

import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/toast';
import { useSession } from '@/cloud/session';
import { setMostUsedEnabled, useMostUsedItems, useUpdateMostUsed, type MostUsedItem } from '@/hooks/useMostUsed';
import { __ } from '@/lib/i18n';
import { DEFAULT_DASHBOARD_ICON, DEFAULT_LIST_ICON, listColor, listIcon, type ListIconComponent } from '@/lib/listIcons';
import { cn } from '@/lib/utils';

import { usePeekHold } from './peekHold';

/**
 * v0.1.385 — «Más usadas» arriba del árbol de listas (reemplaza a
 * «Recientes»): las listas y tableros que la persona usa de verdad, con un
 * orden que no se mueve mientras trabaja. Sin nada que califique todavía
 * (una visita suelta no cuenta), la sección no se dibuja.
 */
export const MostUsedPanelSection = memo(function MostUsedPanelSection(): JSX.Element | null {
    const { items } = useMostUsedItems();
    if (items.length === 0) return null;
    return (
        <div className="imcrm-group/mu imcrm-flex imcrm-flex-col imcrm-gap-1" data-tour="panel-most-used">
            <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-pl-2.5 imcrm-pr-1">
                <h3 className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-pb-1 imcrm-text-[10px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-[0.1em] imcrm-text-muted-foreground">
                    {__('Más usadas')}
                </h3>
                <MostUsedMenu triggerClassName="imcrm-mb-1 lg:imcrm-opacity-0 group-hover/mu:imcrm-opacity-100" />
            </div>
            <ul className="imcrm-flex imcrm-flex-col imcrm-gap-0.5" data-testid="panel-most-used">
                {items.map((it) => {
                    const Icon = mostUsedIcon(it);
                    const color = listColor(it.color);
                    return (
                        <li key={it.key}>
                            <Link
                                to={it.href}
                                title={it.label}
                                data-most-used={it.key}
                                className="imcrm-flex imcrm-min-h-10 imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1.5 imcrm-text-[14px] imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground lg:imcrm-min-h-0 lg:imcrm-text-[13px]"
                            >
                                <Icon className={cn('imcrm-h-4 imcrm-w-4 imcrm-shrink-0', !color && 'imcrm-opacity-60')} style={color ? { color } : undefined} aria-hidden />
                                <span className="imcrm-min-w-0 imcrm-truncate">{it.label}</span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
});

export function mostUsedIcon(it: MostUsedItem): ListIconComponent {
    return listIcon(it.icon) ?? (it.kind === 'dashboard' ? DEFAULT_DASHBOARD_ICON : DEFAULT_LIST_ICON);
}

/**
 * El «…» de la sección: qué es, ocultarla (con «Deshacer») y el atajo a
 * Ajustes → Apariencia, donde se vuelve a mostrar o se empieza de cero.
 */
export function MostUsedMenu({ triggerClassName }: { triggerClassName?: string }): JSX.Element {
    const [open, setOpen] = useState(false);
    const update = useUpdateMostUsed();
    const toast = useToast();
    const navigate = useNavigate();
    const peekHold = usePeekHold();
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);

    // El flotante del riel se sostiene mientras el menú esté abierto.
    useEffect(() => {
        peekHold(open);
    }, [open, peekHold]);
    useEffect(() => () => peekHold(false), [peekHold]);

    const hide = (): void => {
        // El aviso sale ya: al ocultarse la sección este menú se desmonta y
        // un callback de la mutación no llegaría a correr.
        update.mutate({ enabled: false });
        toast.show({
            title: __('Ocultaste «Más usadas»'),
            description: __('Puedes volver a mostrarla en Ajustes → Cuenta → Apariencia.'),
            variant: 'info',
            duration: 8000,
            action: { label: __('Deshacer'), onClick: () => void setMostUsedEnabled(qc, tenantId, true) },
        });
    };

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    aria-label={__('Opciones de «Más usadas»')}
                    data-testid="most-used-menu"
                    onClick={(e) => e.stopPropagation()}
                    // En táctil no hay hover: queda visible tenue (como el resto del panel).
                    className={cn(
                        'imcrm-shrink-0 imcrm-rounded imcrm-p-1.5 imcrm-text-muted-foreground imcrm-opacity-60 hover:imcrm-bg-accent hover:imcrm-text-foreground lg:imcrm-p-0.5',
                        triggerClassName,
                        open && 'imcrm-text-foreground lg:imcrm-opacity-100',
                    )}
                >
                    <MoreHorizontal className="imcrm-h-4 imcrm-w-4 lg:imcrm-h-3.5 lg:imcrm-w-3.5" />
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="imcrm-w-72" onClick={(e) => e.stopPropagation()}>
                <p className="imcrm-px-2 imcrm-py-1.5 imcrm-text-[12px] imcrm-leading-snug imcrm-text-muted-foreground" data-testid="most-used-explain">
                    {__('Las listas y tableros que más abres. Aparecen cuando los usas en dos días distintos, y el orden se renueva al día siguiente para no moverse mientras trabajas.')}
                </p>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={hide} data-testid="most-used-hide">
                    <EyeOff className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Ocultar esta sección')}
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => navigate('/settings?s=apariencia')} data-testid="most-used-settings">
                    <SlidersHorizontal className="imcrm-h-3.5 imcrm-w-3.5" />
                    {__('Ajustes de la sección')}
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
