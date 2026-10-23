import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
    ChartColumn,
    Columns3,
    Database,
    LayoutGrid,
    Loader2,
    RotateCcw,
    Rows3,
    Search,
    Trash2,
    X,
    Zap,
    type LucideIcon,
} from 'lucide-react';

import {
    TRASH_ITEM_TYPES,
    TRASH_TYPE_LABELS,
    TRASH_TYPE_PLURALS,
    trashDaysLeft,
    type TrashItem,
    type TrashItemType,
} from '@imagina-base/shared';

import { relativeTime } from '@/admin/activity/activityText';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useLists } from '@/hooks/useLists';
import { useEmptyTrash, usePurgeFromTrash, useRestoreFromTrash, useTrashPage } from '@/hooks/useTrash';
import { FIELD_TYPE_CATALOG } from '@/lib/fieldTypeCatalog';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTimeStr } from '@/lib/tenantFormat';
import { parseUtcDate } from '@/lib/utcDate';
import { cn } from '@/lib/utils';

const TYPE_ICON: Record<TrashItemType, LucideIcon> = {
    record: Rows3,
    list: Database,
    field: Columns3,
    view: LayoutGrid,
    automation: Zap,
    dashboard: ChartColumn,
};

const VIEW_TYPE_LABEL: Record<string, string> = {
    table: 'Tabla',
    kanban: 'Kanban',
    calendar: 'Calendario',
    cards: 'Tarjetas',
    gantt: 'Gantt',
};

const TRIGGER_LABEL: Record<string, string> = {
    record_created: 'Al crear un registro',
    record_updated: 'Al cambiar un registro',
    field_changed: 'Al cambiar un campo',
    status_changed: 'Al cambiar el estado',
    due_date_reached: 'Por vencimiento',
    scheduled: 'En un horario',
    incoming_webhook: 'Webhook entrante',
    payment_received: 'Al recibir un pago',
    form_submitted: 'Al enviar un formulario',
    button_pressed: 'Al presionar el botón',
};

const PAGE_SIZE = 25;

/** Lo que dice debajo del nombre: de qué lista es, qué tipo, cuánto se llevó. */
export function trashItemDetail(item: TrashItem): string {
    const parts: string[] = [];
    if (item.type === 'field' && item.subtype) {
        parts.push(FIELD_TYPE_CATALOG.find((t) => t.slug === item.subtype)?.label ?? item.subtype);
    }
    if (item.type === 'view' && item.subtype) parts.push(__(VIEW_TYPE_LABEL[item.subtype] ?? item.subtype));
    if (item.type === 'automation' && item.subtype) parts.push(__(TRIGGER_LABEL[item.subtype] ?? item.subtype));
    if (item.list_name) parts.push(sprintf(__('en «%s»'), item.list_name));
    if (item.type === 'list' && item.children !== null) {
        parts.push(item.children === 1 ? __('con 1 registro') : sprintf(__('con %d registros'), item.children));
    }
    if (item.type === 'record' && item.children) {
        parts.push(item.children === 1 ? __('con 1 subtarea') : sprintf(__('con %d subtareas'), item.children));
    }
    return parts.join(' · ');
}

/** El nombre a mostrar (un registro sin título se nombra por su número). */
export function trashItemName(item: TrashItem): string {
    if (item.name.trim() !== '') return item.name;
    return item.type === 'record' ? sprintf(__('Registro #%d'), item.id) : __('(sin nombre)');
}

/**
 * Ajustes → Papelera: todo lo que se borró (registros, listas, campos,
 * vistas, automatizaciones y tableros), recuperable durante el plazo. Quien lo
 * borró o un admin lo restaura o lo borra para siempre; un admin la vacía.
 * `?list=<id>` la abre acotada a una lista (el acceso desde la lista).
 */
export function TrashPanel(): JSX.Element {
    const [params, setParams] = useSearchParams();
    const listId = Number(params.get('list')) || undefined;
    const typeParam = params.get('type');
    const [type, setType] = useState<TrashItemType | undefined>(
        (TRASH_ITEM_TYPES as readonly string[]).includes(typeParam ?? '') ? (typeParam as TrashItemType) : undefined,
    );
    const [draft, setDraft] = useState('');
    const q = useDebouncedValue(draft.trim(), 300);
    const [page, setPage] = useState(1);
    useEffect(() => setPage(1), [type, q, listId]);

    const query = useTrashPage({ type, q: q || undefined, list_id: listId, page, limit: PAGE_SIZE });
    const meta = query.data?.meta;
    const items = query.data?.items ?? [];
    const empty = useEmptyTrash();
    const confirm = useConfirm();
    const toast = useToast();
    const days = meta?.retention_days ?? 30;
    const allCount = meta ? Object.values(meta.counts).reduce((a, b) => a + b, 0) : 0;
    const lists = useLists();
    const listName = listId
        ? (lists.data?.find((l) => l.id === listId)?.name ?? items.find((i) => i.list_id === listId)?.list_name)
        : undefined;

    const clearList = (): void => {
        setParams(
            (prev) => {
                const next = new URLSearchParams(prev);
                next.delete('list');
                next.delete('type');
                return next;
            },
            { replace: true },
        );
    };

    const onEmpty = async (): Promise<void> => {
        const ok = await confirm({
            title: __('¿Vaciar la papelera?'),
            description: sprintf(
                __('Se borran para siempre las %d cosas que hay en la papelera de la empresa (también lo que borraron otras personas). Esto ya no se puede deshacer.'),
                allCount,
            ),
            confirmLabel: __('Vaciar papelera'),
            destructive: true,
        });
        if (!ok) return;
        empty.mutate(undefined, {
            onSuccess: (r) => toast.success(r.purged === 1 ? __('Se borró 1 cosa para siempre.') : sprintf(__('Se borraron %d cosas para siempre.'), r.purged)),
            onError: (err) => toast.error(__('No se pudo vaciar la papelera'), err instanceof Error ? err.message : String(err)),
        });
    };

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-testid="trash-panel">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-justify-between imcrm-gap-3">
                <p className="imcrm-max-w-2xl imcrm-text-sm imcrm-text-muted-foreground">
                    {sprintf(
                        __('Lo que se borra queda aquí %d días: se restaura tal cual (una lista vuelve con sus registros, campos, vistas y automatizaciones; un registro, con sus subtareas, vínculos, archivos y comentarios). Después se borra para siempre.'),
                        days,
                    )}
                </p>
                {meta?.can_empty && allCount > 0 && (
                    <Button
                        variant="outline"
                        size="sm"
                        className="imcrm-gap-1.5 imcrm-border-destructive/40 imcrm-text-destructive hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                        disabled={empty.isPending}
                        onClick={() => void onEmpty()}
                        data-testid="trash-empty"
                    >
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Vaciar papelera')}
                    </Button>
                )}
            </div>

            {listId !== undefined && (
                <div
                    className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-3 imcrm-py-2 imcrm-text-sm"
                    data-testid="trash-list-filter"
                >
                    <span>
                        {listName ? sprintf(__('Sólo lo de la lista «%s»'), listName) : __('Sólo lo de una lista')}
                    </span>
                    <Button variant="ghost" size="sm" className="imcrm-h-7 imcrm-gap-1 imcrm-px-2" onClick={clearList}>
                        <X className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Ver toda la papelera')}
                    </Button>
                </div>
            )}

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 md:imcrm-flex-row md:imcrm-items-center">
                <div className="imcrm-relative md:imcrm-w-72">
                    <Search className="imcrm-pointer-events-none imcrm-absolute imcrm-left-2.5 imcrm-top-1/2 imcrm-h-4 imcrm-w-4 -imcrm-translate-y-1/2 imcrm-text-muted-foreground" />
                    <Input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={__('Buscar por nombre…')}
                        className="imcrm-pl-8"
                        aria-label={__('Buscar en la papelera')}
                        data-testid="trash-search"
                    />
                </div>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5" role="group" aria-label={__('Filtrar por tipo')}>
                    <TypeChip active={type === undefined} label={__('Todo')} count={allCount} onClick={() => setType(undefined)} />
                    {TRASH_ITEM_TYPES.map((t) => (
                        <TypeChip
                            key={t}
                            active={type === t}
                            label={__(TRASH_TYPE_PLURALS[t])}
                            count={meta?.counts[t] ?? 0}
                            onClick={() => setType(type === t ? undefined : t)}
                            value={t}
                        />
                    ))}
                </div>
            </div>

            {query.isLoading ? (
                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                    {__('Cargando…')}
                </p>
            ) : query.isError ? (
                <p className="imcrm-text-sm imcrm-text-destructive">{__('No se pudo cargar la papelera.')}</p>
            ) : items.length === 0 ? (
                <div
                    className="imcrm-flex imcrm-items-center imcrm-gap-3 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-4"
                    data-testid="trash-empty-state"
                >
                    <Trash2 className="imcrm-h-5 imcrm-w-5 imcrm-shrink-0 imcrm-text-muted-foreground" />
                    <p className="imcrm-text-sm">
                        {q || type
                            ? __('No hay nada en la papelera que coincida con eso.')
                            : __('La papelera está vacía.')}
                    </p>
                </div>
            ) : (
                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-overflow-hidden imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card">
                    {items.map((i) => (
                        <TrashRow key={`${i.type}:${i.id}`} item={i} />
                    ))}
                </ul>
            )}

            {meta && meta.total_pages > 1 && (
                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-text-sm">
                    <span className="imcrm-text-muted-foreground">
                        {sprintf(__('Página %1$d de %2$d · %3$d en total'), meta.page, meta.total_pages, meta.total)}
                    </span>
                    <div className="imcrm-flex imcrm-gap-2">
                        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                            {__('Anterior')}
                        </Button>
                        <Button variant="outline" size="sm" disabled={page >= meta.total_pages} onClick={() => setPage((p) => p + 1)}>
                            {__('Siguiente')}
                        </Button>
                    </div>
                </div>
            )}
        </section>
    );
}

function TypeChip({
    active,
    label,
    count,
    onClick,
    value,
}: {
    active: boolean;
    label: string;
    count: number;
    onClick: () => void;
    value?: string;
}): JSX.Element {
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={onClick}
            data-type={value ?? 'all'}
            className={cn(
                'imcrm-inline-flex imcrm-h-7 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-border imcrm-px-2.5 imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
                active
                    ? 'imcrm-border-primary/40 imcrm-bg-primary/10 imcrm-text-foreground'
                    : 'imcrm-border-border imcrm-bg-background imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground',
            )}
        >
            {label}
            <span className="imcrm-tabular-nums imcrm-opacity-70">{count}</span>
        </button>
    );
}

function TrashRow({ item }: { item: TrashItem }): JSX.Element {
    const restore = useRestoreFromTrash();
    const purge = usePurgeFromTrash();
    const confirm = useConfirm();
    const toast = useToast();
    const Icon = TYPE_ICON[item.type];
    const left = trashDaysLeft(parseUtcDate(item.purge_at));
    const name = trashItemName(item);
    const detail = trashItemDetail(item);
    const busy = restore.isPending || purge.isPending;

    const onRestore = (): void => {
        restore.mutate(
            { type: item.type, id: item.id },
            {
                onSuccess: (r) => toast.success(r.message),
                onError: (err) => toast.error(__('No se pudo restaurar'), err instanceof Error ? err.message : String(err)),
            },
        );
    };

    const onPurge = async (): Promise<void> => {
        const ok = await confirm({
            title: sprintf(__('¿Borrar «%s» para siempre?'), name),
            description:
                item.type === 'list'
                    ? __('Se borra la lista con todos sus registros, campos, vistas y automatizaciones. Esto ya no se puede deshacer.')
                    : __('Ya no se podrá recuperar. Esto ya no se puede deshacer.'),
            confirmLabel: __('Borrar para siempre'),
            destructive: true,
        });
        if (!ok) return;
        purge.mutate(
            { type: item.type, id: item.id },
            {
                onSuccess: () => toast.success(sprintf(__('«%s» se borró para siempre.'), name)),
                onError: (err) => toast.error(__('No se pudo borrar'), err instanceof Error ? err.message : String(err)),
            },
        );
    };

    return (
        <li
            className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-p-3 sm:imcrm-flex-row sm:imcrm-items-center"
            data-trash-item={`${item.type}:${item.id}`}
        >
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-items-start imcrm-gap-3">
                <span className="imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted imcrm-text-muted-foreground">
                    <Icon className="imcrm-h-4 imcrm-w-4" />
                </span>
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5">
                        <span className="imcrm-truncate imcrm-text-sm imcrm-font-medium" data-testid="trash-item-name">
                            {name}
                        </span>
                        <Badge variant="secondary">{__(TRASH_TYPE_LABELS[item.type])}</Badge>
                    </div>
                    {detail && <p className="imcrm-mt-0.5 imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground">{detail}</p>}
                    <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground" title={formatDateTimeStr(item.deleted_at)}>
                        {item.deleted_by_name
                            ? sprintf(__('Lo borró %1$s %2$s'), item.deleted_by_name, relativeTime(item.deleted_at))
                            : sprintf(__('Borrado %s'), relativeTime(item.deleted_at))}
                    </p>
                </div>
            </div>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 sm:imcrm-shrink-0 sm:imcrm-justify-end">
                <Badge variant={left <= 3 ? 'warning' : 'outline'} title={sprintf(__('Se borra para siempre el %s'), formatDateTimeStr(item.purge_at))}>
                    {left === 0 ? __('Se borra hoy') : left === 1 ? __('Queda 1 día') : sprintf(__('Quedan %d días'), left)}
                </Badge>
                {item.can_restore ? (
                    <>
                        <Button size="sm" className="imcrm-gap-1.5" disabled={busy} onClick={onRestore} data-testid="trash-restore">
                            {restore.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <RotateCcw className="imcrm-h-3.5 imcrm-w-3.5" />}
                            {__('Restaurar')}
                        </Button>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="imcrm-text-destructive hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                            disabled={busy}
                            onClick={() => void onPurge()}
                            data-testid="trash-purge"
                        >
                            {__('Borrar para siempre')}
                        </Button>
                    </>
                ) : (
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{__('Lo restaura quien lo borró o un admin')}</span>
                )}
                {item.type !== 'list' && item.type !== 'dashboard' && item.list_slug && (
                    <Link
                        to={`/lists/${item.list_slug}/records`}
                        className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground hover:imcrm-underline"
                    >
                        {__('Ir a la lista')}
                    </Link>
                )}
            </div>
        </li>
    );
}
