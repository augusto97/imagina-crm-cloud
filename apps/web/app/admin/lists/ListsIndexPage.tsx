import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    AlertCircle,
    ArrowRight,
    Calendar,
    Database,
    FileStack,
    Plus,
    Sparkles,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { StatTile } from '@/components/ui/stat-tile';
import { useLists } from '@/hooks/useLists';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCan } from '@/lib/permissions';
import { ListCreateDialog } from '@/admin/lists/ListCreateDialog';

export function ListsIndexPage(): JSX.Element {
    const lists = useLists();
    const [dialogOpen, setDialogOpen] = useState(false);
    const canCreateList = useCan(CAP.MANAGE_LISTS);

    const stats = useMemo(() => {
        const all = lists.data ?? [];
        const last7d = all.filter((l) => {
            const d = new Date(l.updated_at + 'Z').getTime();
            return Date.now() - d < 7 * 24 * 60 * 60 * 1000;
        }).length;
        const withDescription = all.filter((l) => l.description && l.description.trim() !== '').length;
        return {
            total: all.length,
            last7d,
            withDescription,
        };
    }, [lists.data]);

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-6">
            {/* Page header */}
            <header className="imcrm-flex imcrm-items-end imcrm-justify-between imcrm-gap-4">
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                    <h1 className="imcrm-text-[28px] imcrm-font-semibold imcrm-leading-none imcrm-tracking-tight imcrm-text-foreground">
                        {__('Listas')}
                    </h1>
                    <p className="imcrm-text-[13px] imcrm-text-muted-foreground">
                        {__('Click en una lista para abrirla. Cada una es un contenedor de registros con campos y vistas configurables.')}
                    </p>
                </div>
                {canCreateList && (
                    <Button className="imcrm-gap-1.5" onClick={() => setDialogOpen(true)}>
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Nueva lista')}
                    </Button>
                )}
            </header>

            {/* StatTiles */}
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3 md:imcrm-grid-cols-4">
                <StatTile
                    icon={FileStack}
                    label={__('Total')}
                    value={stats.total}
                    tone="cyan"
                    active
                />
                <StatTile
                    icon={Calendar}
                    label={__('Últimos 7 días')}
                    value={stats.last7d}
                    tone="mint"
                    hint={stats.last7d === 1 ? __('1 lista actualizada') : sprintf(__('%d listas actualizadas'), stats.last7d)}
                />
                <StatTile
                    icon={Sparkles}
                    label={__('Documentadas')}
                    value={stats.withDescription}
                    tone="violet"
                    hint={__('Con descripción')}
                />
                <StatTile
                    icon={Database}
                    label={__('Slug ocupados')}
                    value={stats.total}
                    tone="slate"
                    hint={__('1 slug por lista')}
                />
            </div>

            {lists.isError && (
                <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-3.5 imcrm-text-sm imcrm-text-destructive">
                    <AlertCircle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                    <span>
                        {sprintf(
                            __('No se pudieron cargar las listas: %s'),
                            (lists.error as Error).message,
                        )}
                    </span>
                </div>
            )}

            {lists.isLoading ? (
                <SkeletonGrid />
            ) : lists.data && lists.data.length > 0 ? (
                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-4 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3">
                    {lists.data.map((list) => (
                        <ListCard key={list.id} list={list} />
                    ))}
                </div>
            ) : (
                <ListsEmpty onCreate={() => setDialogOpen(true)} />
            )}

            <ListCreateDialog open={dialogOpen} onOpenChange={setDialogOpen} />
        </div>
    );
}

function ListCard({
    list,
}: {
    list: { id: number; slug: string; name: string; description: string | null; updated_at: string };
}): JSX.Element {
    return (
        <Link
            to={`/lists/${list.slug}/records`}
            className="imcrm-group imcrm-relative imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-5 imcrm-shadow-imcrm-sm imcrm-transition-all imcrm-duration-200 hover:imcrm--translate-y-0.5 hover:imcrm-border-primary/30 hover:imcrm-shadow-imcrm-md"
        >
            <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-bg-primary/10 imcrm-text-primary imcrm-ring-1 imcrm-ring-primary/15">
                    <Database className="imcrm-h-4 imcrm-w-4" />
                </span>
                <ArrowRight className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground/40 imcrm-transition-all group-hover:imcrm-translate-x-0.5 group-hover:imcrm-text-primary" />
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <h3 className="imcrm-truncate imcrm-text-[15px] imcrm-font-semibold imcrm-tracking-tight imcrm-text-foreground">
                    {list.name}
                </h3>
                {list.description ? (
                    <p className="imcrm-line-clamp-2 imcrm-text-[13px] imcrm-leading-relaxed imcrm-text-muted-foreground">
                        {list.description}
                    </p>
                ) : (
                    <p className="imcrm-text-[13px] imcrm-italic imcrm-text-muted-foreground/60">
                        {__('Sin descripción')}
                    </p>
                )}
            </div>

            <footer className="imcrm-mt-auto imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3 imcrm-text-[11px]">
                <code className="imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-muted-foreground">
                    /{list.slug}
                </code>
                <span className="imcrm-text-muted-foreground">
                    {sprintf(
                        __('Editado %s'),
                        new Date(list.updated_at + 'Z').toLocaleDateString(),
                    )}
                </span>
            </footer>
        </Link>
    );
}

function SkeletonGrid(): JSX.Element {
    return (
        <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-4 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3">
            {[0, 1, 2].map((i) => (
                <div
                    key={i}
                    className="imcrm-h-44 imcrm-animate-pulse imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-muted/40"
                />
            ))}
        </div>
    );
}

function ListsEmpty({ onCreate }: { onCreate: () => void }): JSX.Element {
    const canCreate = useCan(CAP.MANAGE_LISTS);
    return (
        <EmptyState
            icon={Database}
            title={__('Aún no hay listas')}
            description={
                canCreate
                    ? __('Crea tu primera lista para empezar a capturar registros.')
                    : __('Tu rol no tiene listas asignadas todavía. Contacta al administrador.')
            }
            action={
                canCreate ? (
                    <Button onClick={onCreate} className="imcrm-gap-2">
                        <Plus className="imcrm-h-4 imcrm-w-4" />
                        {__('Nueva lista')}
                    </Button>
                ) : undefined
            }
        />
    );
}
