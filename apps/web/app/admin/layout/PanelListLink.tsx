import { NavLink } from 'react-router';
import { Pin, type LucideIcon } from 'lucide-react';

import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * PanelLink + estrella al hover (anclar/desanclar). La estrella NO navega
 * (preventDefault + stopPropagation) y queda visible fija si ya es favorito.
 */
export function PanelListLink({
    to,
    name,
    starred,
    icon: Icon,
    iconColor,
    onToggleStar,
}: {
    to: string;
    name: string;
    starred: boolean;
    icon?: LucideIcon;
    /** Color del icono (hex). v0.1.137 — icono propio por lista. */
    iconColor?: string;
    onToggleStar: () => void;
}): JSX.Element {
    return (
        <div className="imcrm-group/fav imcrm-relative">
            <NavLink
                to={to}
                className={({ isActive }) =>
                    cn(
                        'imcrm-flex imcrm-items-center imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1.5 imcrm-pr-8 imcrm-text-[13px] imcrm-transition-colors imcrm-duration-100',
                        isActive
                            ? 'imcrm-bg-background imcrm-font-medium imcrm-text-foreground imcrm-shadow-imcrm-sm imcrm-ring-1 imcrm-ring-border'
                            : 'imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground',
                    )
                }
            >
                {Icon !== undefined ? (
                    <Icon
                        className={cn(
                            'imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0',
                            iconColor === undefined && 'imcrm-opacity-60',
                        )}
                        style={iconColor !== undefined ? { color: iconColor } : undefined}
                        aria-hidden
                    />
                ) : (
                    <span
                        aria-hidden
                        className="imcrm-h-1.5 imcrm-w-1.5 imcrm-shrink-0 imcrm-rounded-full imcrm-bg-current imcrm-opacity-50"
                    />
                )}
                <span className="imcrm-truncate">{name}</span>
            </NavLink>
            <button
                type="button"
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onToggleStar();
                }}
                aria-label={starred ? __('Quitar de favoritos') : __('Anclar a favoritos')}
                title={starred ? __('Quitar de favoritos') : __('Anclar a favoritos')}
                aria-pressed={starred}
                className={cn(
                    'imcrm-absolute imcrm-right-1.5 imcrm-top-1/2 -imcrm-translate-y-1/2 imcrm-rounded imcrm-p-1 imcrm-transition-opacity',
                    // v0.1.109 — pin NEUTRO sin relleno (la estrella ámbar
                    // resaltaba demasiado): anclado = visible fijo en tinta
                    // suave; sin anclar = aparece al hover en muted.
                    starred
                        ? 'imcrm-text-foreground/70 imcrm-opacity-100 hover:imcrm-text-foreground'
                        : 'imcrm-text-muted-foreground imcrm-opacity-0 hover:imcrm-text-foreground group-hover/fav:imcrm-opacity-100 focus-visible:imcrm-opacity-100',
                )}
            >
                <Pin className="imcrm-h-3.5 imcrm-w-3.5" />
            </button>
        </div>
    );
}
