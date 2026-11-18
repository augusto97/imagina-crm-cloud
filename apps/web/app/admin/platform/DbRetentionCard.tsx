import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, Loader2, Sparkles } from 'lucide-react';
import {
    ACTIVITY_RETENTION_OPTIONS,
    RUNS_RETENTION_OPTIONS,
    type DbTableSize,
    type PlatformRetentionStatus,
    type UpdatePlatformRetentionInput,
} from '@imagina-base/shared';

import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { __, sprintf } from '@/lib/i18n';
import { formatDateTimeStr, formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { diskSize as size } from './diskSize';

/**
 * v0.1.439 — Plataforma → Diagnóstico → «Tamaño de la base». Lo que más pesa
 * en la base, cuánto se guarda lo que crece con el uso (el historial de
 * corridas de automatizaciones y, si el operador quiere, la actividad de los
 * registros) y la última limpieza. Sin esto la base crecía sin que nadie lo
 * viera hasta que el disco se llenaba.
 */
const QK = ['platform-retention'] as const;

/** Nombre para mostrar de lo que borró una limpieza. */
const DELETED_LABEL: Record<string, string> = {
    notifications: 'avisos',
    reminders: 'recordatorios',
    incidents: 'Problemas resueltos',
    ai_agent_runs: 'corridas de agentes',
    sms_messages: 'SMS',
    bulk_edits: 'ediciones masivas',
    oauth_clients: 'apps conectadas sin usar',
    automation_runs: 'corridas de automatizaciones',
    activity: 'líneas de actividad',
};

function daysLabel(days: number): string {
    if (days % 365 === 0) return days === 365 ? __('1 año') : sprintf(__('%d años'), days / 365);
    return sprintf(__('%d días'), days);
}

export function DbRetentionCard(): JSX.Element | null {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const toast = useToast();
    const q = useQuery({
        queryKey: QK,
        queryFn: () => api.retentionGet(),
        // Mientras corre una limpieza pedida a mano, se pregunta seguido.
        refetchInterval: (query) => ((query.state.data as PlatformRetentionStatus | undefined)?.running ? 2000 : 60_000),
    });
    const save = useMutation({
        mutationFn: (input: UpdatePlatformRetentionInput) => api.retentionUpdate(input),
        onMutate: async (input) => {
            await qc.cancelQueries({ queryKey: QK });
            const prev = qc.getQueryData<PlatformRetentionStatus>(QK);
            if (prev) qc.setQueryData<PlatformRetentionStatus>(QK, { ...prev, settings: { ...prev.settings, ...input } });
            return { prev };
        },
        onError: (err, _input, ctx) => {
            if (ctx?.prev) qc.setQueryData(QK, ctx.prev);
            toast.error(__('No se pudo guardar'), err instanceof Error ? err.message : String(err));
        },
        onSuccess: (st) => qc.setQueryData(QK, st),
    });
    const run = useMutation({
        mutationFn: () => api.retentionRun(),
        onSuccess: (st) => {
            qc.setQueryData(QK, st);
            toast.success(__('Limpiando'), __('Se borra en tandas; el resultado aparece aquí en unos segundos.'));
        },
        onError: (err) => toast.error(__('No se pudo limpiar'), err instanceof Error ? err.message : String(err)),
    });

    if (q.isLoading || !q.data) return null;
    const st = q.data;
    const runs = st.settings.automation_runs_days;
    const act = st.settings.activity_days;
    const last = st.last;
    const deleted = last ? Object.entries(last.deleted).filter(([, n]) => n > 0) : [];

    const onActivity = (value: string): void => {
        const next = value === 'forever' ? null : Number(value);
        if (next === null || (act !== null && next >= act)) {
            save.mutate({ activity_days: next });
            return;
        }
        void confirm({
            title: __('¿Borrar la actividad vieja?'),
            description: sprintf(
                __('La actividad de más de %s se borra en la próxima limpieza y ya no se ve en la ficha de cada registro ni se puede restaurar desde ahí. Los registros y sus datos no se tocan.'),
                daysLabel(next),
            ),
            confirmLabel: __('Sí, ponerle plazo'),
            destructive: true,
        }).then((ok) => ok && save.mutate({ activity_days: next }));
    };

    return (
        <Card data-testid="db-retention" data-tour="platform-db-retention">
            <CardHeader>
                <div className="imcrm-flex imcrm-items-start imcrm-gap-3">
                    <span className="imcrm-flex imcrm-h-9 imcrm-w-9 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-bg-muted/70 imcrm-text-foreground/60 imcrm-ring-1 imcrm-ring-border">
                        <Database className="imcrm-h-4 imcrm-w-4" aria-hidden />
                    </span>
                    <div>
                        <CardTitle>{__('Tamaño de la base')}</CardTitle>
                        <CardDescription>
                            {st.db_bytes !== null
                                ? sprintf(__('La base ocupa %s. Esto es lo que más pesa y cuánto se guarda lo que crece con el uso.'), size(st.db_bytes))
                                : __('Lo que más pesa en la base y cuánto se guarda lo que crece con el uso.')}
                        </CardDescription>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-4">
                {st.tables.length > 0 && (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-text-sm" data-testid="db-tables">
                        {st.tables.map((t) => (
                            <TableRow key={t.table} t={t} max={st.tables[0]?.bytes ?? 1} />
                        ))}
                    </ul>
                )}

                <div className="imcrm-grid imcrm-grid-cols-1 imcrm-gap-4 md:imcrm-grid-cols-2">
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <span className="imcrm-text-sm imcrm-font-medium">{__('Historial de corridas de automatizaciones')}</span>
                        <Select
                            value={runs === null ? 'forever' : String(runs)}
                            onChange={(e) => save.mutate({ automation_runs_days: e.target.value === 'forever' ? null : Number(e.target.value) })}
                            data-testid="retention-runs"
                        >
                            {RUNS_RETENTION_OPTIONS.map((d) => (
                                <option key={d} value={d}>
                                    {d === 90 ? sprintf(__('%s (recomendado)'), daysLabel(d)) : daysLabel(d)}
                                </option>
                            ))}
                            <option value="forever">{__('Siempre')}</option>
                        </Select>
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Se conservan siempre la última corrida de cada automatización, las que esperan y lo que evita que una automatización «por fecha de vencimiento» se dispare otra vez.')}
                        </span>
                    </label>
                    <label className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <span className="imcrm-text-sm imcrm-font-medium">{__('Actividad de los registros')}</span>
                        <Select value={act === null ? 'forever' : String(act)} onChange={(e) => onActivity(e.target.value)} data-testid="retention-activity">
                            <option value="forever">{__('Siempre (recomendado)')}</option>
                            {ACTIVITY_RETENTION_OPTIONS.map((d) => (
                                <option key={d} value={d}>
                                    {daysLabel(d)}
                                </option>
                            ))}
                        </Select>
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Es la historia de cada registro: quién cambió qué y cuándo. Ponle plazo sólo si la base crece de más.')}
                        </span>
                    </label>
                </div>

                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-2 imcrm-border-t imcrm-pt-3">
                    <div className="imcrm-max-w-xl imcrm-text-xs imcrm-text-muted-foreground" data-testid="retention-last">
                        {st.running ? (
                            <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                                <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" aria-hidden /> {__('Limpiando…')}
                            </span>
                        ) : !last ? (
                            __('La base se limpia sola cada hora.')
                        ) : last.error ? (
                            <span className="imcrm-text-destructive">{sprintf(__('La última limpieza (%1$s) falló: %2$s'), formatDateTimeStr(last.at), last.error)}</span>
                        ) : (
                            <>
                                {sprintf(__('Última limpieza: %s.'), formatDateTimeStr(last.at))}{' '}
                                {deleted.length === 0
                                    ? __('No había nada viejo para borrar.')
                                    : sprintf(
                                          __('Se borraron %s.'),
                                          deleted.map(([t, n]) => `${formatNumber(n)} ${__(DELETED_LABEL[t] ?? t)}`).join(', '),
                                      )}
                                {last.more && ` ${__('Queda más: sigue en la próxima vuelta (cada hora).')}`}
                            </>
                        )}
                    </div>
                    <Button size="sm" variant="outline" className="imcrm-gap-1.5" disabled={run.isPending || st.running} onClick={() => run.mutate()} data-testid="retention-run">
                        <Sparkles className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                        {__('Limpiar ahora')}
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

function TableRow({ t, max }: { t: DbTableSize; max: number }): JSX.Element {
    const pct = max > 0 ? Math.max(2, Math.round((t.bytes / max) * 100)) : 0;
    return (
        <li className="imcrm-flex imcrm-flex-col imcrm-gap-1 imcrm-rounded imcrm-bg-muted/40 imcrm-px-2.5 imcrm-py-1.5" data-table={t.table}>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-x-3 imcrm-gap-y-1">
                <span className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2">
                    <span className={cn('imcrm-truncate', !t.label && 'imcrm-font-mono imcrm-text-xs')}>{t.label ? __(t.label) : t.table}</span>
                    {t.pruned === 'auto' && (
                        <Badge variant="secondary" className="imcrm-shrink-0">
                            {__('Se limpia sola')}
                        </Badge>
                    )}
                    {t.pruned === 'setting' && (
                        <Badge variant="outline" className="imcrm-shrink-0">
                            {__('Según tu ajuste')}
                        </Badge>
                    )}
                </span>
                <span className="imcrm-shrink-0 imcrm-tabular-nums imcrm-text-muted-foreground">
                    {sprintf(__('%1$s filas · %2$s'), formatNumber(t.rows), size(t.bytes))}
                </span>
            </div>
            <div className="imcrm-h-1 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                <div className="imcrm-h-full imcrm-bg-primary/60" style={{ width: `${pct}%` }} />
            </div>
        </li>
    );
}
