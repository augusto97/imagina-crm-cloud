import { createContext, useContext } from 'react';
import { Link } from 'react-router';
import { Pin, PinOff } from 'lucide-react';

import { useMediaQuery } from '@/hooks/useMediaQuery';

import { __, sprintf } from '@/lib/i18n';
import { DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { formatDateStr } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';
import { cn } from '@/lib/utils';
import type { ListGroup, ListSummary } from '@/types/list';

import { FolderSquare, IconSquare } from './FolderBadge';

/** v0.1.342 — dentro de un `CardGrid` angosto, cada lista es una FILA. */
const RowMode = createContext(false);

/**
 * Tarjeta de una lista (v0.1.211) — compartida por el índice de Listas y la
 * página de una carpeta (v0.1.212): icono y color reales, descripción, chip
 * de carpeta opcional y pin para anclar a favoritos.
 *
 * v0.1.342 — en el teléfono (<640 px) la grilla pasa a ser una lista de
 * filas compactas, como las apps: antes cada tarjeta ocupaba media pantalla
 * (ícono grande, «Sin descripción», el slug y la fecha) y se veían dos listas
 * por pantalla.
 */
export function CardGrid({ children }: { children: React.ReactNode }): JSX.Element {
    const narrow = useMediaQuery('(max-width: 639px)');
    if (narrow) {
        return (
            <RowMode.Provider value>
                <div className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card" data-testid="lists-rows">
                    {children}
                </div>
            </RowMode.Provider>
        );
    }
    return (
        <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-4 sm:imcrm-grid-cols-2 lg:imcrm-grid-cols-3">{children}</div>
    );
}

/** Fecha local `YYYY-MM-DD` de un timestamp, en el formato de la empresa. */
function localDate(ts: string): string {
    const d = parseUtcDate(ts);
    if (Number.isNaN(d.getTime())) return ts;
    const p = (n: number) => String(n).padStart(2, '0');
    return formatDateStr(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
}

export function ListCard({
    list,
    folder,
    pinned,
    onTogglePin,
}: {
    list: ListSummary;
    /** Sólo en la vista "Todas": la carpeta de la lista como chip. */
    folder: ListGroup | undefined;
    pinned: boolean;
    onTogglePin: () => void;
}): JSX.Element {
    const row = useContext(RowMode);
    if (row) return <ListRow list={list} folder={folder} pinned={pinned} onTogglePin={onTogglePin} />;
    return (
        <div
            data-tour="lists-card"
            className="imcrm-group/card imcrm-relative imcrm-flex imcrm-flex-col imcrm-overflow-hidden imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-card imcrm-shadow-imcrm-sm imcrm-transition-all imcrm-duration-200 hover:imcrm--translate-y-0.5 hover:imcrm-border-primary/30 hover:imcrm-shadow-imcrm-md"
            data-testid="lists-index-card"
            data-list={list.slug}
        >
            <Link to={`/lists/${list.slug}/records`} className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-3 imcrm-p-5">
                <IconSquare icon={listIcon(list.icon) ?? DEFAULT_LIST_ICON} color={listColor(list.color)} size="lg" />
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    <h3 className="imcrm-truncate imcrm-pr-6 imcrm-text-[15px] imcrm-font-semibold imcrm-tracking-tight imcrm-text-foreground">
                        {list.name}
                    </h3>
                    {list.description ? (
                        <p className="imcrm-line-clamp-2 imcrm-text-[13px] imcrm-leading-relaxed imcrm-text-muted-foreground">
                            {list.description}
                        </p>
                    ) : (
                        <p className="imcrm-text-[13px] imcrm-italic imcrm-text-muted-foreground/60">{__('Sin descripción')}</p>
                    )}
                </div>

                <footer className="imcrm-mt-auto imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-3 imcrm-text-[11px]">
                    {folder ? (
                        <span
                            className="imcrm-inline-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-text-muted-foreground"
                            data-testid="lists-index-card-folder"
                        >
                            <FolderSquare group={folder} size="sm" />
                            <span className="imcrm-truncate">{folder.name}</span>
                        </span>
                    ) : (
                        <code className="imcrm-truncate imcrm-rounded imcrm-bg-muted imcrm-px-1.5 imcrm-py-0.5 imcrm-font-mono imcrm-text-muted-foreground">
                            /{list.slug}
                        </code>
                    )}
                    <span className="imcrm-shrink-0 imcrm-text-muted-foreground">
                        {sprintf(__('Editado %s'), localDate(list.updated_at))}
                    </span>
                </footer>
            </Link>
            <button
                type="button"
                onClick={onTogglePin}
                aria-pressed={pinned}
                aria-label={pinned ? __('Quitar de favoritos') : __('Anclar a favoritos')}
                title={pinned ? __('Quitar de favoritos') : __('Anclar a favoritos')}
                data-testid="lists-index-card-pin"
                className={cn(
                    'imcrm-absolute imcrm-right-3 imcrm-top-3 imcrm-rounded imcrm-p-1.5 imcrm-transition-opacity hover:imcrm-bg-accent',
                    // Anclada: visible fija en tinta suave. Sin anclar: al
                    // hover; en táctil (sin hover) queda visible tenue.
                    pinned
                        ? 'imcrm-text-foreground/70 hover:imcrm-text-foreground'
                        : 'imcrm-text-muted-foreground imcrm-opacity-40 hover:imcrm-text-foreground focus-visible:imcrm-opacity-100 group-hover/card:imcrm-opacity-100 lg:imcrm-opacity-0',
                )}
            >
                {pinned ? <PinOff className="imcrm-h-4 imcrm-w-4" /> : <Pin className="imcrm-h-4 imcrm-w-4" />}
            </button>
        </div>
    );
}

/** v0.1.342 — la lista como fila (teléfono): ícono, nombre, una línea de contexto y el pin. */
function ListRow({
    list,
    folder,
    pinned,
    onTogglePin,
}: {
    list: ListSummary;
    folder: ListGroup | undefined;
    pinned: boolean;
    onTogglePin: () => void;
}): JSX.Element {
    const sub = folder ? folder.name : list.description;
    return (
        <div className="imcrm-flex imcrm-items-center" data-testid="lists-index-card" data-list={list.slug} data-tour="lists-card">
            <Link
                to={`/lists/${list.slug}/records`}
                className="imcrm-flex imcrm-min-h-[60px] imcrm-min-w-0 imcrm-flex-1 imcrm-items-center imcrm-gap-3 imcrm-py-2.5 imcrm-pl-3.5 imcrm-pr-1 imcrm-transition-colors active:imcrm-bg-muted/60"
            >
                <IconSquare icon={listIcon(list.icon) ?? DEFAULT_LIST_ICON} color={listColor(list.color)} size="md" />
                <span className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                    <span className="imcrm-truncate imcrm-text-[15px] imcrm-font-medium imcrm-text-foreground">{list.name}</span>
                    {sub && (
                        <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1 imcrm-text-[12px] imcrm-text-muted-foreground" data-testid={folder ? 'lists-index-card-folder' : undefined}>
                            {folder && <FolderSquare group={folder} size="sm" />}
                            <span className="imcrm-truncate">{sub}</span>
                        </span>
                    )}
                </span>
            </Link>
            <button
                type="button"
                onClick={onTogglePin}
                aria-pressed={pinned}
                aria-label={pinned ? __('Quitar de favoritos') : __('Anclar a favoritos')}
                title={pinned ? __('Quitar de favoritos') : __('Anclar a favoritos')}
                data-testid="lists-index-card-pin"
                className={cn(
                    'imcrm-mr-1 imcrm-flex imcrm-h-11 imcrm-w-11 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md active:imcrm-bg-muted',
                    pinned ? 'imcrm-text-foreground/70' : 'imcrm-text-muted-foreground/60',
                )}
            >
                {pinned ? <PinOff className="imcrm-h-4 imcrm-w-4" /> : <Pin className="imcrm-h-4 imcrm-w-4" />}
            </button>
        </div>
    );
}
