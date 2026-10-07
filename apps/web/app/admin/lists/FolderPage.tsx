import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ChevronRight, FolderX, Loader2, Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { EMPTY_FAVORITES, toggledFavorites, useFavorites, useUpdateFavorites } from '@/hooks/useFavorites';
import { useListGroups } from '@/hooks/useListGroups';
import { useLists } from '@/hooks/useLists';
import { matchesListQuery } from '@/lib/folderSections';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { parseUtcDate } from '@/lib/utcDate';
import { ListCreateDialog } from '@/admin/lists/ListCreateDialog';

import { FolderSquare } from './FolderBadge';
import { CardGrid, ListCard } from './ListCard';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Espacio de una carpeta (v0.1.212): al hacer click en el NOMBRE de una
 * carpeta del menú se abre esta página con SÓLO sus listas — como abrir un
 * espacio en ClickUp —, en vez de tener que buscarlas entre todas. Mismas
 * tarjetas que el índice (icono y color reales, pin a favoritos), buscador y
 * "Nueva lista" que nace adentro de la carpeta.
 */
export function FolderPage(): JSX.Element {
    const { folderId } = useParams<{ folderId: string }>();
    const id = Number(folderId);
    const groups = useListGroups();
    const lists = useLists();
    const favorites = useFavorites();
    const updateFavorites = useUpdateFavorites();
    const canCreateList = useCan(CAP.MANAGE_LISTS);
    const [query, setQuery] = useState('');
    const [creating, setCreating] = useState(false);

    const group = (groups.data ?? []).find((g) => g.id === id);
    const inside = useMemo(() => (lists.data ?? []).filter((l) => l.group_id === id), [lists.data, id]);
    const visible = useMemo(() => inside.filter((l) => matchesListQuery(l, query)), [inside, query]);
    const recent = inside.filter((l) => Date.now() - parseUtcDate(l.updated_at).getTime() < WEEK_MS).length;
    const favs = favorites.data ?? EMPTY_FAVORITES;

    if (groups.isLoading || lists.isLoading) {
        return (
            <div className="imcrm-flex imcrm-h-64 imcrm-items-center imcrm-justify-center">
                <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
            </div>
        );
    }

    if (!group) {
        return (
            <EmptyState
                icon={FolderX}
                title={__('Esta carpeta no existe')}
                description={__('Puede que la hayan borrado o renombrado. Sus listas, si tenía, están en la página de Listas.')}
                action={
                    <Button asChild variant="outline">
                        <Link to="/lists">{__('Ver todas las listas')}</Link>
                    </Button>
                }
            />
        );
    }

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-6" data-testid="folder-page" data-folder={group.id}>
            <nav aria-label={__('Ruta')} className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-xs imcrm-text-muted-foreground">
                <Link to="/lists" className="hover:imcrm-text-foreground hover:imcrm-underline">
                    {__('Listas')}
                </Link>
                <ChevronRight className="imcrm-h-3 imcrm-w-3" aria-hidden />
                <span className="imcrm-truncate imcrm-text-foreground">{group.name}</span>
            </nav>

            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-4">
                <div className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-3">
                    <FolderSquare group={group} size="lg" />
                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1">
                        <h1 className="imcrm-truncate imcrm-text-xl imcrm-font-semibold imcrm-leading-none imcrm-tracking-tight imcrm-text-foreground">
                            {group.name}
                        </h1>
                        <p className="imcrm-text-[13px] imcrm-text-muted-foreground" data-testid="folder-page-summary">
                            {inside.length === 1 ? __('1 lista') : sprintf(__('%d listas'), inside.length)}
                            {recent > 0 &&
                                ` · ${recent === 1 ? __('1 actualizada esta semana') : sprintf(__('%d actualizadas esta semana'), recent)}`}
                        </p>
                    </div>
                </div>
                {canCreateList && (
                    <Button className="imcrm-gap-1.5" onClick={() => setCreating(true)} data-testid="folder-page-new">
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Nueva lista')}
                    </Button>
                )}
            </header>

            {inside.length === 0 ? (
                <EmptyState
                    icon={Plus}
                    title={__('Esta carpeta está vacía')}
                    description={
                        canCreateList
                            ? __('Creá una lista acá, o arrastrá una desde el menú lateral hasta el nombre de la carpeta.')
                            : __('Todavía no hay listas en esta carpeta.')
                    }
                    action={
                        canCreateList ? (
                            <Button onClick={() => setCreating(true)} className="imcrm-gap-2">
                                <Plus className="imcrm-h-4 imcrm-w-4" />
                                {__('Nueva lista')}
                            </Button>
                        ) : undefined
                    }
                />
            ) : (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                    {inside.length > 3 && (
                        <div className="imcrm-relative imcrm-w-full sm:imcrm-max-w-xs">
                            <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-1/2 imcrm-h-3.5 imcrm-w-3.5 -imcrm-translate-y-1/2 imcrm-text-muted-foreground" />
                            <Input
                                value={query}
                                onChange={(e) => setQuery(e.target.value)}
                                placeholder={sprintf(__('Buscar en %s…'), group.name)}
                                className="imcrm-h-8 imcrm-pl-8 imcrm-text-[13px]"
                                data-testid="folder-page-search"
                            />
                        </div>
                    )}
                    {visible.length === 0 ? (
                        <p className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-py-10 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                            {sprintf(__('Ninguna lista coincide con «%s».'), query.trim())}
                        </p>
                    ) : (
                        <CardGrid>
                            {visible.map((l) => (
                                <ListCard
                                    key={l.id}
                                    list={l}
                                    folder={undefined}
                                    pinned={favs.lists.includes(l.id)}
                                    onTogglePin={() => updateFavorites.mutate(toggledFavorites(favs, 'lists', l.id))}
                                />
                            ))}
                        </CardGrid>
                    )}
                </div>
            )}

            {creating && (
                <ListCreateDialog
                    open
                    onOpenChange={(o) => !o && setCreating(false)}
                    groupId={group.id}
                    groupName={group.name}
                />
            )}
        </div>
    );
}
