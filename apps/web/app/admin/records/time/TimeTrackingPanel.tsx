import { useState } from 'react';
import { Clock, Download, Loader2, Pencil, Play, Plus, Square, Trash2 } from 'lucide-react';
import { formatTimerClock, formatTrackedSeconds, parseDuration, type TimeEntryDto } from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/toast';
import {
    downloadTimeCsv,
    runningSeconds,
    useActiveTimer,
    useCreateTimeEntry,
    useDeleteTimeEntry,
    useRecordTime,
    useStartTimer,
    useStopTimer,
    useUpdateTimeEntry,
} from '@/hooks/useTimeTracking';
import { useNow } from '@/hooks/useNow';
import { getBootData } from '@/lib/boot';
import { __, sprintf } from '@/lib/i18n';
import { CAP, useCanAny } from '@/lib/permissions';
import { formatDateStr } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

/**
 * v0.1.288 — Registro de tiempo de la ficha: el cronómetro (uno en curso por
 * persona en toda la empresa: iniciar aquí detiene el que corría en otro
 * registro y lo guarda), cargas a mano («1h 30m»), las entradas de cada uno y
 * el total. Lo usan la ficha clásica (modal y página) y el bloque «Registro de
 * tiempo» de la ficha diseñada.
 */
export function TimeTrackingPanel({
    listId,
    listKey,
    recordId,
    compact = false,
}: {
    listId: number;
    /** Slug de la lista (para el CSV y el nombre del archivo). */
    listKey: string;
    recordId: number;
    /** Sin el título de la tarjeta (el bloque v3 ya trae su marco). */
    compact?: boolean;
}): JSX.Element {
    const time = useRecordTime(listId, recordId);
    const active = useActiveTimer();
    const start = useStartTimer(listId, recordId);
    const stop = useStopTimer();
    const toast = useToast();
    const canExport = useCanAny(CAP.EXPORT_RECORDS);
    const [adding, setAdding] = useState(false);
    const data = time.data;
    const mine = data?.my_running ?? null;
    const now = useNow(mine !== null);
    const elsewhere = active.data && active.data.entry.record_id !== recordId ? active.data : null;

    const onStart = (): void => {
        start.mutate(undefined, {
            onSuccess: (res) => {
                if (res.stopped) toast.success(__('Cronómetro iniciado'), __('Se detuvo y guardó el que tenías en curso.'));
            },
            onError: (err) => toast.error(__('No se pudo iniciar el cronómetro'), err instanceof Error ? err.message : ''),
        });
    };
    const onStop = (): void => {
        stop.mutate(undefined, {
            onError: (err) => toast.error(__('No se pudo detener el cronómetro'), err instanceof Error ? err.message : ''),
        });
    };

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-3" data-testid="imcrm-time-panel" aria-label={__('Registro de tiempo')}>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2">
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col">
                    {!compact && (
                        <h3 className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-xs imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                            <Clock className="imcrm-h-3.5 imcrm-w-3.5" /> {__('Tiempo registrado')}
                        </h3>
                    )}
                    <span className="imcrm-text-xl imcrm-font-semibold imcrm-tabular-nums" data-testid="imcrm-time-total">
                        {time.isLoading ? '…' : formatTrackedSeconds(data?.total_seconds ?? 0)}
                    </span>
                </div>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                {mine ? (
                    <>
                        <span
                            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-full imcrm-bg-primary/10 imcrm-px-2.5 imcrm-py-1 imcrm-font-mono imcrm-text-sm imcrm-tabular-nums imcrm-text-primary"
                            data-testid="imcrm-time-running"
                            aria-live="off"
                        >
                            <span aria-hidden className="imcrm-h-2 imcrm-w-2 imcrm-animate-pulse imcrm-rounded-full imcrm-bg-primary" />
                            {formatTimerClock(runningSeconds(mine, now))}
                        </span>
                        <Button size="sm" variant="outline" className="imcrm-h-8 imcrm-gap-1.5" onClick={onStop} disabled={stop.isPending} data-testid="imcrm-time-stop">
                            <Square className="imcrm-h-3.5 imcrm-w-3.5 imcrm-fill-current" />
                            {__('Detener')}
                        </Button>
                    </>
                ) : (
                    <Button size="sm" className="imcrm-h-8 imcrm-gap-1.5" onClick={onStart} disabled={start.isPending || time.isLoading} data-testid="imcrm-time-start">
                        {start.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Play className="imcrm-h-3.5 imcrm-w-3.5 imcrm-fill-current" />}
                        {__('Iniciar cronómetro')}
                    </Button>
                )}
                    {/* Cargar tiempo a mano también con el cronómetro corriendo. */}
                    <Button size="sm" variant="outline" className="imcrm-h-8 imcrm-gap-1.5" onClick={() => setAdding((v) => !v)} aria-expanded={adding} data-testid="imcrm-time-add">
                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Registrar')}
                    </Button>
                </div>
            </div>
            {elsewhere && !mine && (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {sprintf(__('Tienes un cronómetro en curso en «%s»: iniciar uno aquí lo detiene y lo guarda.'), elsewhere.record_title)}
                </p>
            )}

            {adding && <ManualEntryForm listId={listId} recordId={recordId} onDone={() => setAdding(false)} />}

            {time.isError ? (
                <p className="imcrm-text-xs imcrm-text-destructive">{(time.error as Error).message}</p>
            ) : data && data.entries.length > 0 ? (
                <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border" data-testid="imcrm-time-entries">
                    {data.entries.map((e) => (
                        <EntryRow
                            key={e.id}
                            entry={e}
                            listId={listId}
                            recordId={recordId}
                            canEdit={data.can_manage_all || e.user_id === getBootData().user.id}
                            now={now}
                        />
                    ))}
                </ul>
            ) : !time.isLoading ? (
                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Todavía no hay tiempo registrado en este registro.')}</p>
            ) : null}

            {data && data.by_user.length > 1 && (
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-testid="imcrm-time-by-user">
                    <span className="imcrm-text-[11px] imcrm-font-semibold imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">{__('Por persona')}</span>
                    <ul className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-4 imcrm-gap-y-1 imcrm-text-xs">
                        {data.by_user.map((u) => (
                            <li key={u.user_id ?? 0} className="imcrm-flex imcrm-gap-1.5">
                                <span className="imcrm-text-muted-foreground">{u.user_name ?? __('Usuario eliminado')}</span>
                                <span className="imcrm-font-medium imcrm-tabular-nums">{formatTrackedSeconds(u.seconds)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                {data && data.entries_count > data.entries.length ? (
                    <span>{sprintf(__('Se muestran las últimas %1$d de %2$d entradas.'), data.entries.length, data.entries_count)}</span>
                ) : (
                    <span />
                )}
                {canExport && (
                    <button
                        type="button"
                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                        onClick={() =>
                            void downloadTimeCsv(listKey).catch((err) =>
                                toast.error(__('No se pudo exportar'), err instanceof Error ? err.message : ''),
                            )
                        }
                        data-testid="imcrm-time-export"
                    >
                        <Download className="imcrm-h-3 imcrm-w-3" />
                        {__('Exportar el tiempo de la lista (CSV)')}
                    </button>
                )}
            </div>
        </section>
    );
}

function EntryRow({
    entry,
    listId,
    recordId,
    canEdit,
    now,
}: {
    entry: TimeEntryDto;
    listId: number;
    recordId: number;
    canEdit: boolean;
    now: number;
}): JSX.Element {
    const update = useUpdateTimeEntry(listId, recordId);
    const remove = useDeleteTimeEntry(listId, recordId);
    const confirm = useConfirm();
    const toast = useToast();
    const [editing, setEditing] = useState(false);
    const [date, setDate] = useState(entry.work_date);
    const [duration, setDuration] = useState(formatTrackedSeconds(entry.seconds));
    const [note, setNote] = useState(entry.note);
    const parsed = parseDuration(duration);
    const durationError = !entry.running && (!parsed.ok || parsed.value < 1);

    const save = (): void => {
        const patch: { id: number; work_date?: string; duration?: string; note?: string } = { id: entry.id };
        if (date !== entry.work_date) patch.work_date = date;
        if (!entry.running && duration !== formatTrackedSeconds(entry.seconds)) patch.duration = duration;
        if (note.trim() !== entry.note) patch.note = note.trim();
        if (Object.keys(patch).length === 1) {
            setEditing(false);
            return;
        }
        update.mutate(patch, {
            onSuccess: () => setEditing(false),
            onError: (err) => toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : ''),
        });
    };
    const del = async (): Promise<void> => {
        const ok = await confirm({
            title: __('Eliminar entrada de tiempo'),
            description: sprintf(__('Se quitarán %s del total del registro.'), formatTrackedSeconds(entry.seconds)),
            destructive: true,
            confirmLabel: __('Eliminar'),
        });
        if (ok) remove.mutate(entry.id, { onError: (err) => toast.error(__('No se pudo eliminar'), err instanceof Error ? err.message : '') });
    };

    if (editing) {
        return (
            <li className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-p-2.5">
                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                    <Input type="date" className="imcrm-h-8 imcrm-text-xs" value={date} onChange={(e) => setDate(e.target.value)} aria-label={__('Fecha')} />
                    <Input
                        className={cn('imcrm-h-8 imcrm-text-xs', durationError && 'imcrm-border-destructive')}
                        value={duration}
                        disabled={entry.running}
                        onChange={(e) => setDuration(e.target.value)}
                        aria-label={__('Duración')}
                        placeholder="1h 30m"
                    />
                </div>
                <Input className="imcrm-h-8 imcrm-text-xs" value={note} onChange={(e) => setNote(e.target.value)} placeholder={__('Nota (opcional)')} aria-label={__('Nota')} maxLength={500} />
                <div className="imcrm-flex imcrm-gap-2">
                    <Button size="sm" className="imcrm-h-7" onClick={save} disabled={update.isPending || durationError || date === ''}>
                        {__('Guardar')}
                    </Button>
                    <Button size="sm" variant="ghost" className="imcrm-h-7" onClick={() => setEditing(false)}>
                        {__('Cancelar')}
                    </Button>
                </div>
            </li>
        );
    }
    return (
        <li className="imcrm-group/time imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-px-2.5 imcrm-py-2" data-testid="imcrm-time-entry">
            <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-col">
                <span className="imcrm-flex imcrm-flex-wrap imcrm-items-baseline imcrm-gap-x-1.5 imcrm-text-[13px]">
                    <span className="imcrm-font-medium">{entry.user_name ?? __('Usuario eliminado')}</span>
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">{formatDateStr(entry.work_date)}</span>
                    {entry.source === 'timer' && !entry.running && <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{__('cronómetro')}</span>}
                </span>
                {entry.note && <span className="imcrm-truncate imcrm-text-xs imcrm-text-muted-foreground" title={entry.note}>{entry.note}</span>}
            </div>
            <span className={cn('imcrm-shrink-0 imcrm-text-sm imcrm-font-medium imcrm-tabular-nums', entry.running && 'imcrm-text-primary')}>
                {entry.running
                    ? sprintf(__('en curso · %s'), formatTimerClock(runningSeconds(entry, now)))
                    : entry.seconds > 0 && entry.seconds < 60
                      ? sprintf(__('%d s'), entry.seconds)
                      : formatTrackedSeconds(entry.seconds)}
            </span>
            {canEdit && (
                <span className="imcrm-flex imcrm-shrink-0 imcrm-gap-0.5 [@media(hover:hover)]:imcrm-opacity-0 [@media(hover:hover)]:group-hover/time:imcrm-opacity-100 focus-within:imcrm-opacity-100">
                    <button
                        type="button"
                        onClick={() => setEditing(true)}
                        className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground"
                        aria-label={__('Editar entrada')}
                        title={__('Editar')}
                    >
                        <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                    </button>
                    <button
                        type="button"
                        onClick={() => void del()}
                        className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                        aria-label={__('Eliminar entrada')}
                        title={__('Eliminar')}
                    >
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    </button>
                </span>
            )}
        </li>
    );
}

function ManualEntryForm({ listId, recordId, onDone }: { listId: number; recordId: number; onDone: () => void }): JSX.Element {
    const create = useCreateTimeEntry(listId, recordId);
    const toast = useToast();
    const [date, setDate] = useState(todayLocal());
    const [duration, setDuration] = useState('');
    const [note, setNote] = useState('');
    const [touched, setTouched] = useState(false);
    const parsed = parseDuration(duration);
    const error =
        duration.trim() === ''
            ? __('Escribe cuánto tiempo, por ejemplo «1h 30m».')
            : !parsed.ok
              ? __('Escribe una duración como «1h 30m», «45m» o «1:30».')
              : parsed.value < 1
                ? __('La duración tiene que ser de al menos un minuto.')
                : null;

    const submit = (e: React.FormEvent): void => {
        e.preventDefault();
        setTouched(true);
        if (error !== null || date === '') return;
        create.mutate(
            { work_date: date, duration: duration.trim(), ...(note.trim() ? { note: note.trim() } : {}) },
            {
                onSuccess: () => {
                    toast.success(__('Tiempo registrado'));
                    onDone();
                },
                onError: (err) => toast.error(__('No se pudo registrar'), err instanceof Error ? err.message : ''),
            },
        );
    };

    return (
        <form onSubmit={submit} className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/30 imcrm-p-2.5" data-testid="imcrm-time-form">
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2">
                <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Fecha')}
                    <Input type="date" className="imcrm-h-8 imcrm-text-xs" value={date} max={todayLocal()} onChange={(e) => setDate(e.target.value)} required />
                </label>
                <label className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('Duración')}
                    <Input
                        className={cn('imcrm-h-8 imcrm-text-xs', touched && error && 'imcrm-border-destructive')}
                        value={duration}
                        autoFocus
                        placeholder="1h 30m"
                        onChange={(e) => setDuration(e.target.value)}
                        onBlur={() => setTouched(true)}
                        data-testid="imcrm-time-duration"
                    />
                </label>
            </div>
            <Input className="imcrm-h-8 imcrm-text-xs" value={note} onChange={(e) => setNote(e.target.value)} placeholder={__('Nota (opcional): qué hiciste')} maxLength={500} aria-label={__('Nota')} />
            {touched && error && <p className="imcrm-text-xs imcrm-text-destructive">{error}</p>}
            <div className="imcrm-flex imcrm-gap-2">
                <Button type="submit" size="sm" className="imcrm-h-7" disabled={create.isPending} data-testid="imcrm-time-save">
                    {create.isPending && <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />}
                    {__('Registrar tiempo')}
                </Button>
                <Button type="button" size="sm" variant="ghost" className="imcrm-h-7" onClick={onDone}>
                    {__('Cancelar')}
                </Button>
            </div>
        </form>
    );
}

function todayLocal(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
