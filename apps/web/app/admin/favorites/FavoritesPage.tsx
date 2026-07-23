import { Link } from 'react-router-dom';
import { BarChart3, List as ListIcon, Star } from 'lucide-react';

import { toggledFavorites, useFavorites, useUpdateFavorites } from '@/hooks/useFavorites';
import { useDashboards } from '@/hooks/useDashboards';
import { useLists } from '@/hooks/useLists';
import { __ } from '@/lib/i18n';

/**
 * v0.1.108 — Página del menú "Favoritos" del riel: SOLO los elementos que el
 * usuario ancló (listas y dashboards), como tarjetas navegables. La estrella
 * de cada tarjeta desancla. El anclaje se hace desde los árboles de Listas /
 * Dashboards (estrella al hover) — acá se explica en el estado vacío.
 */
export function FavoritesPage(): JSX.Element {
    const favorites = useFavorites();
    const update = useUpdateFavorites();
    const lists = useLists();
    const dashboards = useDashboards();

    const favs = favorites.data ?? { lists: [], dashboards: [] };
    const listById = new Map((lists.data ?? []).map((l) => [l.id, l]));
    const dashById = new Map((dashboards.data ?? []).map((d) => [d.id, d]));

    const items = [
        ...favs.lists
            .map((id) => listById.get(id))
            .filter((l): l is NonNullable<typeof l> => l !== undefined)
            .map((l) => ({
                key: `l-${l.id}`,
                to: `/lists/${l.slug}/records`,
                name: l.name,
                kindLabel: __('Lista'),
                icon: ListIcon,
                unpin: () => update.mutate(toggledFavorites(favs, 'lists', l.id)),
            })),
        ...favs.dashboards
            .map((id) => dashById.get(id))
            .filter((d): d is NonNullable<typeof d> => d !== undefined)
            .map((d) => ({
                key: `d-${d.id}`,
                to: `/dashboards/${d.id}`,
                name: d.name,
                kindLabel: __('Dashboard'),
                icon: BarChart3,
                unpin: () => update.mutate(toggledFavorites(favs, 'dashboards', d.id)),
            })),
    ];

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
            <header className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">{__('Favoritos')}</h1>
            </header>

            {items.length === 0 ? (
                <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-card imcrm-p-12 imcrm-text-center">
                    <span className="imcrm-flex imcrm-h-12 imcrm-w-12 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-muted-foreground">
                        <Star className="imcrm-h-6 imcrm-w-6" />
                    </span>
                    <h2 className="imcrm-text-base imcrm-font-medium">{__('Todavía no anclaste nada')}</h2>
                    <p className="imcrm-max-w-md imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Pasá el mouse sobre una lista o un dashboard en el menú lateral y tocá la estrella para anclarlo acá.')}
                    </p>
                </div>
            ) : (
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3">
                    {items.map((it) => (
                        <div
                            key={it.key}
                            className="imcrm-group imcrm-relative imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 imcrm-shadow-imcrm-sm imcrm-transition-shadow hover:imcrm-shadow-imcrm-md hover:imcrm-border-primary/25"
                        >
                            <Link to={it.to} className="imcrm-flex imcrm-items-start imcrm-gap-3">
                                <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-text-muted-foreground imcrm-ring-1 imcrm-ring-border">
                                    <it.icon className="imcrm-h-4 imcrm-w-4" />
                                </span>
                                <span className="imcrm-min-w-0">
                                    <span className="imcrm-block imcrm-truncate imcrm-text-sm imcrm-font-medium imcrm-text-foreground">
                                        {it.name}
                                    </span>
                                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{it.kindLabel}</span>
                                </span>
                            </Link>
                            <button
                                type="button"
                                onClick={it.unpin}
                                aria-label={__('Quitar de favoritos')}
                                title={__('Quitar de favoritos')}
                                className="imcrm-absolute imcrm-right-3 imcrm-top-3 imcrm-rounded imcrm-p-1 imcrm-text-amber-500 hover:imcrm-bg-accent"
                            >
                                <Star className="imcrm-h-4 imcrm-w-4 imcrm-fill-current" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
