import { Link } from 'react-router';
import { Pin, PinOff } from 'lucide-react';

import { __, sprintf } from '@/lib/i18n';
import { DEFAULT_LIST_ICON, listColor, listIcon } from '@/lib/listIcons';
import { formatDateStr } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';
import { cn } from '@/lib/utils';
import type { ListGroup, ListSummary } from '@/types/list';

import { FolderSquare, IconSquare } from './FolderBadge';

/**
 * Tarjeta de una lista (v0.1.211) — compartida por el índice de Listas y la
 * página de una carpeta (v0.1.212): icono y color reales, descripción, chip
 * de carpeta opcional y pin para anclar a favoritos.
 */
export function CardGrid({ children }: { children: React.ReactNode }): JSX.Element {
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
    return (
        <div
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
