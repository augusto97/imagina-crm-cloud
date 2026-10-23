import { useState } from 'react';
import { Link } from 'react-router';
import { CheckCircle2, GitBranch, Loader2, Lock, Plus, X } from 'lucide-react';
import type { DependencyKind, DependencyLink } from '@imagina-base/shared';

import { RelationSearch } from '@/components/fields/RelationPicker';
import { chipSoftStyle, type OptionColor } from '@/components/ui/color-picker';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useToast } from '@/components/ui/toast';
import { useAddDependency, useRecordDependencies, useRemoveDependency } from '@/hooks/useDependencies';
import { ApiError } from '@/lib/api';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCanAny } from '@/lib/permissions';
import { cn } from '@/lib/utils';

interface RecordDependenciesProps {
    listId: number;
    listSlug?: string;
    recordId: number;
    /** Abrir otro registro en la misma superficie (el modal cambia de registro). */
    onOpenRecord?: (id: number) => void;
    /** Sin alta ni baja (vista previa del editor de la ficha). */
    readOnly?: boolean;
    /** Sin el encabezado (el bloque de la ficha diseñada ya pone su título). */
    hideHeading?: boolean;
    className?: string;
}

const GROUPS: Array<{ kind: DependencyKind; label: string; empty: string }> = [
    { kind: 'blocked_by', label: __('Bloqueado por'), empty: __('Nada lo bloquea.') },
    { kind: 'blocks', label: __('Bloquea a'), empty: __('No bloquea a ningún registro.') },
];

/**
 * A8 — Sección «Dependencias» de la ficha (modal, página y bloque de la ficha
 * diseñada): lo que BLOQUEA a este registro y lo que él bloquea, con el título
 * y el estado del otro registro. Se agregan con el buscador de registros de
 * la lista (el del servidor: respeta el ACL) y se quitan con la ×. El servidor
 * rechaza los ciclos con el motivo, que se muestra tal cual.
 */
export function RecordDependencies({
    listId,
    listSlug,
    recordId,
    onOpenRecord,
    readOnly = false,
    hideHeading = false,
    className,
}: RecordDependenciesProps): JSX.Element | null {
    const deps = useRecordDependencies(listId, recordId);
    const add = useAddDependency(listId, recordId);
    const remove = useRemoveDependency(listId, recordId);
    const toast = useToast();
    const canEdit = useCanAny(CAP.EDIT_RECORDS, CAP.EDIT_OWN_RECORDS) && !readOnly;
    const [openKind, setOpenKind] = useState<DependencyKind | null>(null);

    const data = deps.data;
    const total = (data?.blocked_by.length ?? 0) + (data?.blocks.length ?? 0);
    const openBlockers = data?.blocked_by.filter((l) => !l.done).length ?? 0;
    if (!deps.isLoading && total === 0 && !canEdit && !readOnly) return null;

    const errorText = (err: unknown): string =>
        err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo guardar la dependencia.');

    const onPick = (kind: DependencyKind, otherId: number): void => {
        const links = kind === 'blocked_by' ? data?.blocked_by : data?.blocks;
        const existing = links?.find((l) => l.record_id === otherId);
        setOpenKind(null);
        if (existing) {
            remove.mutate(existing.id, { onError: (err) => toast.error(__('No se pudo quitar la dependencia'), errorText(err)) });
            return;
        }
        add.mutate(
            { kind, record_id: otherId },
            { onError: (err) => toast.error(__('No se pudo agregar la dependencia'), errorText(err)) },
        );
    };

    const titleNode = (l: DependencyLink): JSX.Element => {
        const label = l.title ?? __('Un registro que no puedes ver');
        if (l.title === null) return <span className="imcrm-min-w-0 imcrm-truncate imcrm-italic imcrm-text-muted-foreground">{label}</span>;
        if (onOpenRecord) {
            return (
                <button type="button" onClick={() => onOpenRecord(l.record_id)} className="imcrm-min-w-0 imcrm-truncate imcrm-text-left imcrm-font-medium hover:imcrm-underline">
                    {label}
                </button>
            );
        }
        return listSlug ? (
            <Link to={`/lists/${listSlug}/records/${l.record_id}`} className="imcrm-min-w-0 imcrm-truncate imcrm-font-medium hover:imcrm-underline">
                {label}
            </Link>
        ) : (
            <span className="imcrm-min-w-0 imcrm-truncate imcrm-font-medium">{label}</span>
        );
    };

    return (
        <section className={cn('imcrm-flex imcrm-flex-col imcrm-gap-2', className)} data-testid="imcrm-record-dependencies">
            {!hideHeading && (
                <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                    <GitBranch className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                    {__('Dependencias')}
                    {total > 0 && <span className="imcrm-font-normal imcrm-normal-case imcrm-text-muted-foreground/70">{total}</span>}
                    {openBlockers > 0 && (
                        <span
                            className="imcrm-ml-1 imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-full imcrm-bg-amber-500/15 imcrm-px-1.5 imcrm-py-px imcrm-font-medium imcrm-normal-case imcrm-tracking-normal imcrm-text-amber-700 dark:imcrm-text-amber-400"
                            data-testid="imcrm-deps-blocked-badge"
                        >
                            <Lock className="imcrm-h-3 imcrm-w-3" aria-hidden />
                            {openBlockers === 1 ? __('Bloqueado') : sprintf(__('Bloqueado por %d'), openBlockers)}
                        </span>
                    )}
                </h3>
            )}
            {deps.isLoading ? (
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-muted-foreground" />
            ) : (
                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                    {GROUPS.map((g) => {
                        const links = (g.kind === 'blocked_by' ? data?.blocked_by : data?.blocks) ?? [];
                        const selected = links.map((l) => l.record_id);
                        return (
                            <div key={g.kind} className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1.5" data-testid={`imcrm-deps-${g.kind}`}>
                                <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                    <span className="imcrm-text-[12px] imcrm-font-medium imcrm-text-muted-foreground">{g.label}</span>
                                    {canEdit && (
                                        <Popover open={openKind === g.kind} onOpenChange={(o) => setOpenKind(o ? g.kind : null)}>
                                            <PopoverTrigger asChild>
                                                <button
                                                    type="button"
                                                    className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-1.5 imcrm-py-0.5 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                                    data-testid={`imcrm-deps-add-${g.kind}`}
                                                    disabled={add.isPending}
                                                >
                                                    {add.isPending && add.variables?.kind === g.kind ? (
                                                        <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                                                    ) : (
                                                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    )}
                                                    {__('Agregar')}
                                                </button>
                                            </PopoverTrigger>
                                            <PopoverContent align="end" className="imcrm-w-80 imcrm-p-0" onClick={(e) => e.stopPropagation()}>
                                                {openKind === g.kind && (
                                                    <RelationSearch
                                                        target={listId}
                                                        selected={selected}
                                                        exclude={[recordId]}
                                                        withSubtasks
                                                        onToggle={(id) => onPick(g.kind, id)}
                                                    />
                                                )}
                                            </PopoverContent>
                                        </Popover>
                                    )}
                                </div>
                                {links.length === 0 ? (
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground/80">{g.empty}</p>
                                ) : (
                                    <ul className="imcrm-flex imcrm-flex-col imcrm-rounded-md imcrm-border imcrm-border-border">
                                        {links.map((l) => (
                                            <li
                                                key={l.id}
                                                className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border/60 imcrm-px-2.5 imcrm-py-1.5 imcrm-text-sm last:imcrm-border-b-0"
                                                data-testid="imcrm-dep-chip"
                                                data-record-id={l.record_id}
                                            >
                                                {l.done ? (
                                                    <CheckCircle2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-emerald-600 dark:imcrm-text-emerald-400" aria-label={__('Terminado')} />
                                                ) : g.kind === 'blocked_by' ? (
                                                    <Lock className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-amber-600 dark:imcrm-text-amber-400" aria-label={__('Abierto')} />
                                                ) : (
                                                    <GitBranch className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                                                )}
                                                <span className={cn('imcrm-flex imcrm-min-w-0 imcrm-flex-1', l.done && 'imcrm-text-muted-foreground imcrm-line-through')}>
                                                    {titleNode(l)}
                                                </span>
                                                {l.lag_days !== 0 && (
                                                    <span className="imcrm-shrink-0 imcrm-text-[11px] imcrm-text-muted-foreground" title={__('Desfase en días')}>
                                                        {l.lag_days > 0 ? `+${l.lag_days} d` : `${l.lag_days} d`}
                                                    </span>
                                                )}
                                                {l.status && (
                                                    <span
                                                        className="imcrm-max-w-[9rem] imcrm-shrink-0 imcrm-truncate imcrm-rounded imcrm-border imcrm-px-1.5 imcrm-py-px imcrm-text-[11px] imcrm-font-medium"
                                                        style={chipSoftStyle(l.status.color as OptionColor | null)}
                                                    >
                                                        {l.status.label}
                                                    </span>
                                                )}
                                                {canEdit && (
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            remove.mutate(l.id, {
                                                                onError: (err) => toast.error(__('No se pudo quitar la dependencia'), errorText(err)),
                                                            })
                                                        }
                                                        aria-label={sprintf(__('Quitar «%s»'), l.title ?? __('dependencia'))}
                                                        className="imcrm-shrink-0 imcrm-rounded imcrm-p-0.5 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                                                        data-testid="imcrm-dep-remove"
                                                    >
                                                        <X className="imcrm-h-3.5 imcrm-w-3.5" />
                                                    </button>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </section>
    );
}
