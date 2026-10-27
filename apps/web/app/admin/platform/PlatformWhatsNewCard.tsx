import { useState } from 'react';
import { Eye, EyeOff, Loader2, Megaphone, MoreHorizontal, MousePointerClick, Pencil, Plus, RotateCcw, Star, Trash2, BookOpen } from 'lucide-react';
import type { PlatformWhatsNewEntry } from '@imagina-base/shared';

import { WhatsNewKindChip } from '@/admin/whats-new/WhatsNewCard';
import { dayLabel } from '@/admin/whats-new/whatsNewMeta';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useDeleteWhatsNew, usePlatformWhatsNew, useRestoreWhatsNew, useUpdateWhatsNew } from '@/hooks/useWhatsNew';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatDateTime, formatNumber } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';
import { cn } from '@/lib/utils';

import { AUDIENCE_ROLE_LABELS, PlatformWhatsNewEditor } from './PlatformWhatsNewEditor';

type OriginFilter = 'all' | 'release' | 'operator';

/** Estado tal como lo lee el operador (programada y vencida son estados derivados). */
function statusOf(e: PlatformWhatsNewEntry, now = Date.now()): { label: string; tone: 'success' | 'info' | 'secondary' | 'warning' | 'outline' } {
    if (e.status === 'draft') return { label: __('Borrador'), tone: 'secondary' };
    if (e.status === 'hidden') return { label: __('Oculta'), tone: 'outline' };
    if (e.expires_at && parseUtcDate(e.expires_at).getTime() <= now) return { label: __('Vencida'), tone: 'warning' };
    if (e.published_at && parseUtcDate(e.published_at).getTime() > now) {
        return { label: sprintf(__('Programada · %s'), formatDateTime(parseUtcDate(e.published_at))), tone: 'info' };
    }
    return { label: __('Publicada'), tone: 'success' };
}

/**
 * Plataforma → Novedades. Las que vienen con cada versión (se pueden ocultar,
 * editar y restaurar) y las que publica el operador, con cuántas personas las
 * vieron, las abrieron y tocaron el botón.
 */
export function PlatformWhatsNewCard(): JSX.Element {
    const list = usePlatformWhatsNew();
    const update = useUpdateWhatsNew();
    const restore = useRestoreWhatsNew();
    const del = useDeleteWhatsNew();
    const confirm = useConfirm();
    const [filter, setFilter] = useState<OriginFilter>('all');
    // `undefined` = cerrado · `null` = nueva · una novedad = edición.
    const [editing, setEditing] = useState<PlatformWhatsNewEntry | null | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);

    const items = (list.data?.items ?? []).filter((e) => filter === 'all' || e.origin === filter);
    const people = list.data?.people ?? 0;

    const run = async (fn: () => Promise<unknown>): Promise<void> => {
        setError(null);
        try {
            await fn();
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
        }
    };

    const remove = async (e: PlatformWhatsNewEntry): Promise<void> => {
        const ok = await confirm({
            title: __('¿Borrar esta novedad?'),
            description: sprintf(__('«%s» deja de verse y se pierden sus estadísticas. No se puede deshacer.'), e.title),
            confirmLabel: __('Borrar'),
            destructive: true,
        });
        if (ok) await run(() => del.mutateAsync(e.id));
    };

    return (
        <Card data-testid="platform-whats-new">
            <CardHeader>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-ring-1 imcrm-ring-border">
                        <Megaphone className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                    </span>
                    <div className="imcrm-min-w-0 imcrm-flex-1">
                        <CardTitle>{__('Novedades')}</CardTitle>
                        <CardDescription>
                            {__('Lo que ven las personas en «Novedades»: lo que trae cada versión y lo que publicas tú (funciones, mejoras, avisos de mantenimiento).')}
                        </CardDescription>
                    </div>
                    <Button type="button" onClick={() => setEditing(null)} data-testid="whats-new-new">
                        <Plus className="imcrm-h-4 imcrm-w-4" aria-hidden />
                        {__('Nueva novedad')}
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                    <div role="group" aria-label={__('Origen')} className="imcrm-flex imcrm-rounded-md imcrm-bg-muted imcrm-p-0.5 imcrm-text-xs">
                        {(
                            [
                                ['all', __('Todas')],
                                ['release', __('De las versiones')],
                                ['operator', __('Publicadas por ti')],
                            ] as Array<[OriginFilter, string]>
                        ).map(([id, label]) => (
                            <button
                                key={id}
                                type="button"
                                aria-pressed={filter === id}
                                onClick={() => setFilter(id)}
                                className={cn('imcrm-rounded imcrm-px-2.5 imcrm-py-1', filter === id ? 'imcrm-bg-background imcrm-font-medium imcrm-shadow-sm' : 'imcrm-text-muted-foreground')}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                    <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1 imcrm-text-xs imcrm-text-muted-foreground">
                        <span>{sprintf(_n(__('%s persona usa la plataforma'), __('%s personas usan la plataforma'), people), formatNumber(people))}</span>
                        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                            <Eye className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {__('la vieron')}
                        </span>
                        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                            <BookOpen className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {__('la abrieron')}
                        </span>
                        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                            <MousePointerClick className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                            {__('tocaron el botón')}
                        </span>
                    </p>
                </div>

                {error && (
                    <p className="imcrm-text-sm imcrm-text-destructive" role="alert">
                        {error}
                    </p>
                )}

                {list.isLoading ? (
                    <div className="imcrm-flex imcrm-justify-center imcrm-py-10">
                        <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" aria-label={__('Cargando…')} />
                    </div>
                ) : list.isError ? (
                    <p className="imcrm-text-sm imcrm-text-destructive">{String(list.error)}</p>
                ) : items.length === 0 ? (
                    <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-8 imcrm-text-center imcrm-text-sm imcrm-text-muted-foreground">
                        {filter === 'operator' ? __('Todavía no publicaste ninguna novedad.') : __('No hay novedades.')}
                    </p>
                ) : (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border">
                        {items.map((e) => {
                            const st = statusOf(e);
                            const date = e.published_at ? parseUtcDate(e.published_at) : null;
                            const audience = [
                                ...e.audience.roles.map((r) => __(AUDIENCE_ROLE_LABELS[r])),
                                ...e.audience.plans.map((p) => sprintf(__('plan %s'), p)),
                            ];
                            return (
                                <li key={e.id} className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-p-3 sm:imcrm-flex-row sm:imcrm-items-start sm:imcrm-gap-4" data-platform-whats-new={e.key}>
                                    <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col imcrm-gap-1.5">
                                        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                                            <WhatsNewKindChip kind={e.kind} />
                                            <Badge variant={st.tone} data-testid="whats-new-status">{st.label}</Badge>
                                            {e.featured && (
                                                <Badge variant="outline" className="imcrm-gap-1">
                                                    <Star className="imcrm-h-3 imcrm-w-3" aria-hidden />
                                                    {__('Destacada')}
                                                </Badge>
                                            )}
                                            {e.edited && (
                                                <Badge variant="warning" data-testid="whats-new-edited">
                                                    {__('Editada')}
                                                </Badge>
                                            )}
                                        </div>
                                        <p className="imcrm-text-sm imcrm-font-semibold imcrm-leading-snug">{e.title}</p>
                                        <p className="imcrm-line-clamp-2 imcrm-text-xs imcrm-text-muted-foreground">{e.summary}</p>
                                        <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                            {e.origin === 'release' ? sprintf(__('Versión %s'), e.version ?? '—') : sprintf(__('Publicada por %s'), e.created_by_name ?? __('el operador'))}
                                            {date && !Number.isNaN(date.getTime()) ? ` · ${dayLabel(date)}` : ''}
                                            {audience.length > 0 ? ` · ${sprintf(__('Para: %s'), audience.join(', '))}` : ''}
                                        </p>
                                    </div>
                                    <div className="imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-gap-3 sm:imcrm-flex-col sm:imcrm-items-end sm:imcrm-gap-2">
                                        <dl className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-text-xs imcrm-tabular-nums" data-testid="whats-new-stats">
                                            <Stat icon={Eye} label={__('La vieron')} value={e.stats.seen} />
                                            <Stat icon={BookOpen} label={__('La abrieron')} value={e.stats.opened} />
                                            <Stat icon={MousePointerClick} label={__('Tocaron el botón')} value={e.stats.clicked} />
                                        </dl>
                                        <div className="imcrm-ml-auto imcrm-flex imcrm-items-center imcrm-gap-1 sm:imcrm-ml-0">
                                            <Button type="button" size="sm" variant="outline" onClick={() => setEditing(e)} data-testid="whats-new-edit">
                                                <Pencil className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                                {__('Editar')}
                                            </Button>
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button type="button" size="sm" variant="ghost" aria-label={sprintf(__('Más acciones de «%s»'), e.title)} data-testid="whats-new-more-actions">
                                                        <MoreHorizontal className="imcrm-h-4 imcrm-w-4" aria-hidden />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    {e.status === 'hidden' ? (
                                                        <DropdownMenuItem onSelect={() => void run(() => update.mutateAsync({ id: e.id, input: { status: 'published' } }))} data-testid="whats-new-show">
                                                            <Eye className="imcrm-h-4 imcrm-w-4" />
                                                            {__('Mostrar')}
                                                        </DropdownMenuItem>
                                                    ) : (
                                                        <DropdownMenuItem onSelect={() => void run(() => update.mutateAsync({ id: e.id, input: { status: 'hidden' } }))} data-testid="whats-new-hide">
                                                            <EyeOff className="imcrm-h-4 imcrm-w-4" />
                                                            {__('Ocultar')}
                                                        </DropdownMenuItem>
                                                    )}
                                                    {e.origin === 'release' && e.edited && e.in_catalog && (
                                                        <DropdownMenuItem onSelect={() => void run(() => restore.mutateAsync(e.id))} data-testid="whats-new-restore-menu">
                                                            <RotateCcw className="imcrm-h-4 imcrm-w-4" />
                                                            {__('Restaurar el texto original')}
                                                        </DropdownMenuItem>
                                                    )}
                                                    {e.origin === 'operator' && (
                                                        <DropdownMenuItem danger onSelect={() => void remove(e)} data-testid="whats-new-delete">
                                                            <Trash2 className="imcrm-h-4 imcrm-w-4" />
                                                            {__('Borrar')}
                                                        </DropdownMenuItem>
                                                    )}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </CardContent>
            {editing !== undefined && (
                <PlatformWhatsNewEditor
                    key={editing?.id ?? 'new'}
                    entry={editing}
                    open
                    onOpenChange={(o) => {
                        if (!o) setEditing(undefined);
                    }}
                />
            )}
        </Card>
    );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Eye; label: string; value: number }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-muted-foreground" title={label}>
            <Icon className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
            <dt className="imcrm-sr-only">{label}</dt>
            <dd className="imcrm-font-medium imcrm-text-foreground">{formatNumber(value)}</dd>
        </div>
    );
}
