import { Link } from 'react-router';
import { Folder, LayoutGrid, Pin, PinOff } from 'lucide-react';

import { ViewSwitch } from '@/components/ui/view-switch';
import { toggledFavorites, useFavorites, useUpdateFavorites } from '@/hooks/useFavorites';
import { useDashboards } from '@/hooks/useDashboards';
import { useListGroups } from '@/hooks/useListGroups';
import { useLists } from '@/hooks/useLists';
import { dashboardColor, dashboardIcon } from '@/lib/dashboardIcon';
import {
    FAVORITES_GROUPING_KEY,
    FAVORITES_GROUPINGS,
    favoriteSections,
    type FavoritesGrouping,
} from '@/lib/favoriteSections';
import { __ } from '@/lib/i18n';
import { DEFAULT_LIST_ICON, listColor, listIcon, type ListIconComponent } from '@/lib/listIcons';
import { formatNumber } from '@/lib/tenantFormat';
import { usePersistedChoice } from '@/lib/usePersistedChoice';
import { FolderSquare, IconSquare } from '@/admin/lists/FolderBadge';

/**
 * Página del menú "Favoritos" del riel (v0.1.108): SOLO los elementos que el
 * usuario ancló (listas y dashboards), como tarjetas navegables; el pin de
 * cada tarjeta desancla.
 *
 * v0.1.211 — agrupados por CARPETA (el mismo orden e iconos del menú de
 * Listas; los dashboards van al final porque no viven en carpetas) o por
 * tipo. La elección se comparte con el panel lateral de Favoritos.
 */
export function FavoritesPage(): JSX.Element {
    const favorites = useFavorites();
    const update = useUpdateFavorites();
    const lists = useLists();
    const dashboards = useDashboards();
    const groups = useListGroups();
    const [grouping, setGrouping] = usePersistedChoice<FavoritesGrouping>(
        FAVORITES_GROUPING_KEY,
        FAVORITES_GROUPINGS,
        'folders',
    );

    const favs = favorites.data ?? { lists: [], dashboards: [] };
    const sections = favoriteSections(favs, lists.data ?? [], dashboards.data ?? [], groups.data ?? [], grouping);
    const hasFolders = (groups.data ?? []).length > 0;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-5">
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-3">
                <h1 className="imcrm-text-xl imcrm-font-semibold imcrm-tracking-tight">{__('Favoritos')}</h1>
                {hasFolders && sections.length > 0 && (
                    <ViewSwitch<FavoritesGrouping>
                        label={__('Agrupar favoritos')}
                        value={grouping}
                        onChange={setGrouping}
                        testId="favorites-grouping"
                        options={[
                            { value: 'folders', label: __('Por carpeta'), icon: Folder },
                            { value: 'type', label: __('Por tipo'), icon: LayoutGrid },
                        ]}
                    />
                )}
            </header>

            {sections.length === 0 ? (
                <div className="imcrm-flex imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-card imcrm-p-12 imcrm-text-center">
                    <span className="imcrm-flex imcrm-h-12 imcrm-w-12 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-muted imcrm-text-muted-foreground">
                        <Pin className="imcrm-h-6 imcrm-w-6" />
                    </span>
                    <h2 className="imcrm-text-base imcrm-font-medium">{__('Todavía no anclaste nada')}</h2>
                    <p className="imcrm-max-w-md imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Pasá el mouse sobre una lista o un dashboard en el menú lateral (o en la página de Listas) y tocá el pin para anclarlo acá.')}
                    </p>
                </div>
            ) : (
                sections.map((s) => {
                    const count = s.lists.length + s.dashboards.length;
                    return (
                        <section
                            key={s.key}
                            className="imcrm-flex imcrm-flex-col imcrm-gap-3"
                            data-testid="favorites-section"
                            data-kind={s.kind}
                        >
                            <div className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border imcrm-pb-2">
                                {s.kind === 'folder' && <FolderSquare group={s.group} size="sm" />}
                                <h2 className="imcrm-truncate imcrm-text-sm imcrm-font-semibold imcrm-text-foreground">
                                    {s.kind === 'folder'
                                        ? s.group.name
                                        : s.kind === 'root'
                                          ? __('Sin carpeta')
                                          : s.kind === 'lists'
                                            ? __('Listas')
                                            : __('Dashboards')}
                                </h2>
                                <span className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-text-[11px] imcrm-font-medium imcrm-tabular-nums imcrm-text-muted-foreground">
                                    {formatNumber(count)}
                                </span>
                            </div>
                            <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-3 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3">
                                {s.lists.map((l) => (
                                    <FavoriteCard
                                        key={`l-${l.id}`}
                                        to={`/lists/${l.slug}/records`}
                                        name={l.name}
                                        kindLabel={__('Lista')}
                                        icon={listIcon(l.icon) ?? DEFAULT_LIST_ICON}
                                        color={listColor(l.color)}
                                        onUnpin={() => update.mutate(toggledFavorites(favs, 'lists', l.id))}
                                    />
                                ))}
                                {s.dashboards.map((d) => (
                                    <FavoriteCard
                                        key={`d-${d.id}`}
                                        to={`/dashboards/${d.id}`}
                                        name={d.name}
                                        kindLabel={__('Dashboard')}
                                        icon={dashboardIcon(d.settings)}
                                        color={dashboardColor(d.settings)}
                                        onUnpin={() => update.mutate(toggledFavorites(favs, 'dashboards', d.id))}
                                    />
                                ))}
                            </div>
                        </section>
                    );
                })
            )}
        </div>
    );
}

function FavoriteCard({
    to,
    name,
    kindLabel,
    icon,
    color,
    onUnpin,
}: {
    to: string;
    name: string;
    kindLabel: string;
    icon: ListIconComponent;
    color: string | undefined;
    onUnpin: () => void;
}): JSX.Element {
    return (
        <div
            className="imcrm-group imcrm-relative imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4 imcrm-shadow-imcrm-sm imcrm-transition-shadow hover:imcrm-border-primary/25 hover:imcrm-shadow-imcrm-md"
            data-testid="favorites-card"
        >
            <Link to={to} className="imcrm-flex imcrm-items-start imcrm-gap-3 imcrm-pr-7">
                <IconSquare icon={icon} color={color} size="lg" />
                <span className="imcrm-min-w-0">
                    <span className="imcrm-block imcrm-truncate imcrm-text-sm imcrm-font-medium imcrm-text-foreground">{name}</span>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{kindLabel}</span>
                </span>
            </Link>
            <button
                type="button"
                onClick={onUnpin}
                aria-label={__('Quitar de favoritos')}
                title={__('Quitar de favoritos')}
                className="imcrm-absolute imcrm-right-3 imcrm-top-3 imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
            >
                <PinOff className="imcrm-h-4 imcrm-w-4" />
            </button>
        </div>
    );
}
