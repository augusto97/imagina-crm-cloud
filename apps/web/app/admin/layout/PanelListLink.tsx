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
                        // v0.1.169 — 40px de alto y 14px en mobile (objetivo
                        // táctil); en escritorio las medidas compactas.
                        'imcrm-flex imcrm-min-h-10 imcrm-items-center imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1.5 imcrm-pr-10 imcrm-text-[14px] imcrm-transition-colors imcrm-duration-100 lg:imcrm-min-h-0 lg:imcrm-pr-8 lg:imcrm-text-[13px]',
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
                    // Mobile: 32px de objetivo táctil; escritorio: compacto.
                    'imcrm-absolute imcrm-right-1 imcrm-top-1/2 -imcrm-translate-y-1/2 imcrm-rounded imcrm-p-2 imcrm-transition-opacity lg:imcrm-right-1.5 lg:imcrm-p-1',
                    // v0.1.109 — pin NEUTRO sin relleno (la estrella ámbar
                    // resaltaba demasiado): anclado = visible fijo en tinta
                    // suave; sin anclar = aparece al hover en muted. En
                    // táctil no hay hover (v0.1.169): queda visible tenue.
                    starred
                        ? 'imcrm-text-foreground/70 imcrm-opacity-100 hover:imcrm-text-foreground'
                        : 'imcrm-text-muted-foreground imcrm-opacity-40 hover:imcrm-text-foreground group-hover/fav:imcrm-opacity-100 focus-visible:imcrm-opacity-100 lg:imcrm-opacity-0',
                )}
            >
                <Pin className="imcrm-h-4 imcrm-w-4 lg:imcrm-h-3.5 lg:imcrm-w-3.5" />
            </button>
        </div>
    );
}
