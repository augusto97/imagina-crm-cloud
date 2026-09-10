import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { MoreHorizontal, Pin } from 'lucide-react';

import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { __, sprintf } from '@/lib/i18n';
import type { ListIconComponent } from '@/lib/listIcons';
import { cn } from '@/lib/utils';

import { usePeekHold } from './peekHold';

/** Lo que el menú contextual de un item recibe del propio item. */
export interface ItemMenuContext {
    /** Pasa la fila a modo "cambiar el nombre" (input inline). */
    startRename: () => void;
}

/**
 * PanelLink + pin al hover (anclar/desanclar) + menú contextual (v0.1.172).
 *
 * El pin NO navega (preventDefault + stopPropagation) y queda visible fijo
 * si ya es favorito. El menú se abre con el botón "…" que aparece al hover
 * (en táctil, visible tenue) y también con CLICK DERECHO sobre la fila —
 * como en ClickUp. Un solo `DropdownMenu` sirve a los dos gestos: el click
 * derecho lo abre anclado al mismo botón, que está en la fila de todos
 * modos (la fila mide ~30px, la diferencia no se nota y se reusa el
 * posicionamiento, el teclado y el cierre de Radix).
 *
 * "Cambiar el nombre" es inline: la fila se convierte en un input (Enter
 * guarda, Escape cancela, blur guarda) — el mismo patrón que las carpetas.
 */
export function PanelListLink({
    to,
    name,
    starred,
    icon: Icon,
    iconColor,
    onToggleStar,
    menu,
    onRename,
    held = false,
}: {
    to: string;
    name: string;
    starred: boolean;
    icon?: ListIconComponent;
    /** Color del icono (hex). v0.1.137 — icono propio por lista. */
    iconColor?: string;
    onToggleStar: () => void;
    /** Contenido del menú contextual (items de DropdownMenu). Sin él, no hay "…". */
    menu?: (ctx: ItemMenuContext) => React.ReactNode;
    /** Guardar el nombre nuevo (habilita el modo rename del menú). */
    onRename?: (name: string) => void;
    /** Un diálogo abierto desde el menú sigue vivo: sostener el flotante. */
    held?: boolean;
}): JSX.Element {
    const [menuOpen, setMenuOpen] = useState(false);
    const [renaming, setRenaming] = useState(false);
    const [draft, setDraft] = useState(name);
    const peekHold = usePeekHold();

    // El flotante del riel se sostiene mientras el menú o un diálogo suyo
    // esté abierto, y se suelta al desmontar.
    useEffect(() => {
        peekHold(menuOpen || held);
    }, [menuOpen, held, peekHold]);
    useEffect(() => () => peekHold(false), [peekHold]);

    const ctx: ItemMenuContext = {
        startRename: () => {
            setDraft(name);
            setRenaming(true);
        },
    };

    const submitRename = (): void => {
        const next = draft.trim();
        setRenaming(false);
        if (next !== '' && next !== name) onRename?.(next);
    };

    if (renaming) {
        return (
            <div className="imcrm-px-1" onClick={(e) => e.stopPropagation()}>
                <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={submitRename}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') submitRename();
                        if (e.key === 'Escape') setRenaming(false);
                    }}
                    onFocus={(e) => e.target.select()}
                    aria-label={__('Nuevo nombre')}
                    data-testid="panel-item-rename"
                    className="imcrm-h-8 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-primary imcrm-bg-background imcrm-px-2 imcrm-text-[14px] imcrm-text-foreground imcrm-outline-none imcrm-ring-2 imcrm-ring-primary/20 lg:imcrm-h-7 lg:imcrm-text-[13px]"
                />
            </div>
        );
    }

    return (
        <div
            className="imcrm-group/fav imcrm-relative"
            onContextMenu={
                menu
                    ? (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setMenuOpen(true);
                      }
                    : undefined
            }
        >
            <NavLink
                to={to}
                className={({ isActive }) =>
                    cn(
                        // v0.1.169 — 40px de alto y 14px en mobile (objetivo
                        // táctil); en escritorio las medidas compactas. El
                        // padding derecho deja lugar al pin y al "…".
                        'imcrm-flex imcrm-min-h-10 imcrm-items-center imcrm-gap-2.5 imcrm-rounded-md imcrm-px-2.5 imcrm-py-1.5 imcrm-text-[14px] imcrm-transition-colors imcrm-duration-100 lg:imcrm-min-h-0 lg:imcrm-text-[13px]',
                        menu ? 'imcrm-pr-[4.5rem] lg:imcrm-pr-14' : 'imcrm-pr-10 lg:imcrm-pr-8',
                        isActive || menuOpen
                            ? 'imcrm-bg-background imcrm-font-medium imcrm-text-foreground imcrm-shadow-imcrm-sm imcrm-ring-1 imcrm-ring-border'
                            : 'imcrm-text-muted-foreground hover:imcrm-bg-muted hover:imcrm-text-foreground',
                    )
                }
            >
                {Icon !== undefined ? (
                    <Icon
                        // v0.1.174 — glifo sólido a 16px (como ClickUp); a
                        // 14px un sólido se lee, pero pierde detalle.
                        className={cn(
                            'imcrm-h-4 imcrm-w-4 imcrm-shrink-0',
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
            <div className="imcrm-absolute imcrm-right-1 imcrm-top-1/2 imcrm-flex -imcrm-translate-y-1/2 imcrm-items-center lg:imcrm-right-1.5">
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
                        'imcrm-rounded imcrm-p-2 imcrm-transition-opacity lg:imcrm-p-1',
                        // v0.1.109 — pin NEUTRO sin relleno (la estrella ámbar
                        // resaltaba demasiado): anclado = visible fijo en tinta
                        // suave; sin anclar = aparece al hover en muted. En
                        // táctil no hay hover (v0.1.169): queda visible tenue.
                        starred
                            ? 'imcrm-text-foreground/70 imcrm-opacity-100 hover:imcrm-text-foreground'
                            : 'imcrm-text-muted-foreground imcrm-opacity-40 hover:imcrm-text-foreground group-hover/fav:imcrm-opacity-100 focus-visible:imcrm-opacity-100 lg:imcrm-opacity-0',
                        menuOpen && 'lg:imcrm-opacity-100',
                    )}
                >
                    <Pin className="imcrm-h-4 imcrm-w-4 lg:imcrm-h-3.5 lg:imcrm-w-3.5" />
                </button>
                {menu && (
                    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
                        <DropdownMenuTrigger asChild>
                            <button
                                type="button"
                                onClick={(e) => e.stopPropagation()}
                                aria-label={sprintf(
                                    /* translators: %s: item name */
                                    __('Acciones de %s'),
                                    name,
                                )}
                                title={__('Más acciones')}
                                data-testid="panel-item-menu"
                                className={cn(
                                    'imcrm-rounded imcrm-p-2 imcrm-text-muted-foreground imcrm-transition-opacity hover:imcrm-text-foreground lg:imcrm-p-1',
                                    'imcrm-opacity-40 group-hover/fav:imcrm-opacity-100 focus-visible:imcrm-opacity-100 lg:imcrm-opacity-0',
                                    menuOpen && 'imcrm-text-foreground lg:imcrm-opacity-100',
                                )}
                            >
                                <MoreHorizontal className="imcrm-h-4 imcrm-w-4 lg:imcrm-h-3.5 lg:imcrm-w-3.5" />
                            </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="start"
                            className="imcrm-min-w-[13rem]"
                            // Los clicks en los items burbujean por el árbol de
                            // React hasta el `<nav>` del panel (cierre del drawer
                            // móvil, cierre del flotante): no son enlaces, así
                            // que no cierran nada por sí solos, pero tampoco
                            // deben "activar" la fila de abajo.
                            onClick={(e) => e.stopPropagation()}
                        >
                            {menu(ctx)}
                        </DropdownMenuContent>
                    </DropdownMenu>
                )}
            </div>
        </div>
    );
}
