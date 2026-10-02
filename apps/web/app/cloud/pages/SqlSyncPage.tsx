import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import {
    EVENT_TIMEZONES,
    SQL_LAST_SYNC_TOKEN,
    SQL_SYNC_INTERVALS,
    describeSqlSchedule,
    sqlSourceIsIncremental,
    type CreateSqlSyncInput,
    type SqlPreviewResult,
    type SqlProcedureParam,
    type SqlSync,
    type SqlSyncDryRun,
    type SqlSyncSchedule,
} from '@imagina-base/shared';
import { AlertTriangle, ArrowLeft, CheckCircle2, Database, Eye, Loader2, Pause, Pencil, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { fieldsKeys, useFields } from '@/hooks/useFields';
import { useLists } from '@/hooks/useLists';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';
import { formatDateTimeStr, formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import {
    FIELD_TYPE_LABEL,
    browserTimeZone,
    keyFields,
    matchField,
    suggestKeyColumn,
    suggestTargets,
    valueFields,
    type ColumnTarget,
} from './sqlSyncForm';

/**
 * Sincronizaciones desde SQL Server / Azure SQL (v0.1.243). Cada una ejecuta
 * una consulta o un procedimiento cada tanto y carga el resultado en una
 * lista, emparejando por una columna clave. El trabajo corre en segundo plano;
 * esta pantalla pregunta el estado seguido mientras hay una corrida en curso.
 */

const INTERVAL_LABEL: Record<number, string> = {
    15: 'Cada 15 minutos',
    30: 'Cada 30 minutos',
    60: 'Cada hora',
    180: 'Cada 3 horas',
    360: 'Cada 6 horas',
    720: 'Cada 12 horas',
    1440: 'Una vez por día',
};

function errText(err: unknown): string {
    if (err instanceof CloudApiError) return err.message;
    return err instanceof Error ? err.message : String(err);
}

export function SqlSyncPage(): JSX.Element {
    const { connectionId } = useParams();
    const id = Number(connectionId);
    const [editing, setEditing] = useState<SqlSync | 'new' | null>(null);

    const connections = useQuery({ queryKey: ['connections'], queryFn: () => api.connectionsList(), retry: false });
    const conn = connections.data?.find((c) => c.id === id) ?? null;
    const syncs = useQuery({
        queryKey: ['sql-syncs', id],
        queryFn: () => api.sqlSyncs(id),
        enabled: Number.isInteger(id) && id > 0,
        retry: false,
        refetchInterval: (q) => ((q.state.data ?? []).some((s) => s.status.running || s.status.queued) ? 2000 : 30_000),
    });

    return (
        <div className="imcrm-mx-auto imcrm-max-w-4xl imcrm-space-y-6 imcrm-p-4 sm:imcrm-p-6" data-testid="imcrm-sql-sync">
            <Link
                to="/settings?s=conectores"
                className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-sm imcrm-text-muted-foreground hover:imcrm-text-foreground"
            >
                <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                {__('Integraciones')}
            </Link>
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                <IntegrationLogo integrationKey="sqlserver" size={44} />
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <h1 className="imcrm-text-xl imcrm-font-semibold">{conn?.account_label ?? __('SQL Server')}</h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Traé el resultado de una consulta o de un procedimiento a una lista, cada tanto, sin duplicar.')}
                    </p>
                </div>
                {editing === null && (
                    <Button onClick={() => setEditing('new')} data-testid="imcrm-sql-sync-new">
                        <Plus className="imcrm-h-4 imcrm-w-4" />
                        {__('Nueva sincronización')}
                    </Button>
                )}
            </header>

            {syncs.isError && <p className="imcrm-text-sm imcrm-text-destructive">{errText(syncs.error)}</p>}

            {editing !== null && (
                <SyncEditor
                    connectionId={id}
                    sync={editing === 'new' ? null : editing}
                    onClose={() => setEditing(null)}
                />
            )}

            {syncs.isLoading ? (
                <div className="imcrm-flex imcrm-h-32 imcrm-items-center imcrm-justify-center">
                    <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
                </div>
            ) : (syncs.data ?? []).length === 0 && editing === null ? (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-8 imcrm-text-center">
                    <Database className="imcrm-mx-auto imcrm-h-8 imcrm-w-8 imcrm-text-muted-foreground" />
                    <p className="imcrm-mt-3 imcrm-text-sm imcrm-font-medium">{__('Todavía no hay sincronizaciones')}</p>
                    <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Elegí qué traer de la base (una consulta o un procedimiento), a qué lista y cada cuánto.')}
                    </p>
                    <Button className="imcrm-mt-4" onClick={() => setEditing('new')}>
                        <Plus className="imcrm-h-4 imcrm-w-4" />
                        {__('Nueva sincronización')}
                    </Button>
                </div>
            ) : (
                <div className="imcrm-space-y-4">
                    {(syncs.data ?? [])
                        .filter((s) => editing === null || editing === 'new' || editing.id !== s.id)
                        .map((s) => (
                            <SyncCard key={s.id} sync={s} connectionId={id} onEdit={() => setEditing(s)} />
                        ))}
                </div>
            )}
        </div>
    );
}

// ── Tarjeta de una sincronización ───────────────────────────────────────

function SyncCard({ sync: s, connectionId, onEdit }: { sync: SqlSync; connectionId: number; onEdit: () => void }): JSX.Element {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const [dry, setDry] = useState<SqlSyncDryRun | null>(null);
    const [showErrors, setShowErrors] = useState(false);
    const refresh = (): void => void qc.invalidateQueries({ queryKey: ['sql-syncs', connectionId] });

    const run = useMutation({ mutationFn: () => api.sqlSyncRun(s.id), onSuccess: refresh });
    const toggle = useMutation({ mutationFn: () => api.sqlSyncUpdate(s.id, { enabled: !s.enabled }), onSuccess: refresh });
    const preview = useMutation({ mutationFn: () => api.sqlSyncDryRun(s.id), onSuccess: setDry });
    const remove = useMutation({ mutationFn: () => api.sqlSyncRemove(s.id), onSuccess: refresh });

    const st = s.status;
    const r = st.last_result;
    const badge = st.running ? (
        <Badge variant="outline" className="imcrm-gap-1">
            <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" />
            {__('Sincronizando…')}
        </Badge>
    ) : st.queued ? (
        <Badge variant="outline">{__('En cola…')}</Badge>
    ) : !s.enabled ? (
        <Badge variant="outline">{__('En pausa')}</Badge>
    ) : st.last_error && !r ? (
        <Badge variant="destructive">{__('Con error')}</Badge>
    ) : st.last_run_at ? (
        <Badge variant="success">{__('Al día')}</Badge>
    ) : (
        <Badge variant="outline">{__('Todavía no corrió')}</Badge>
    );

    return (
        <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card" data-testid="imcrm-sql-sync-card" data-sync={s.id}>
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-gap-3 imcrm-p-4">
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-font-medium">
                        {s.name}
                        {badge}
                    </p>
                    <p className="imcrm-mt-0.5 imcrm-text-sm imcrm-text-muted-foreground">
                        {s.source.kind === 'query' ? __('Consulta') : `${__('Procedimiento')} ${s.source.name}`}
                        {' → '}
                        {s.list_slug ? (
                            <Link to={`/lists/${s.list_slug}`} className="imcrm-underline-offset-2 hover:imcrm-underline">
                                {s.list_name}
                            </Link>
                        ) : (
                            __('(lista borrada)')
                        )}
                        {' · '}
                        {__('clave')} {s.key_column} · {describeSqlSchedule(s.schedule)}
                    </p>
                    <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                        {st.last_run_at ? `${__('Última corrida')}: ${formatDateTimeStr(st.last_run_at)}` : __('Todavía no corrió.')}
                        {st.next_run_at && ` · ${__('Próxima')}: ${formatDateTimeStr(st.next_run_at)}`}
                    </p>
                </div>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                    <Button size="sm" variant="outline" disabled={run.isPending || st.running} onClick={() => run.mutate()} data-testid="imcrm-sql-sync-run">
                        <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Sincronizar ahora')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={preview.isPending} onClick={() => preview.mutate()} data-testid="imcrm-sql-sync-dry">
                        {preview.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Eye className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {__('Vista previa')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={onEdit} data-testid="imcrm-sql-sync-edit">
                        <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Editar')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate()}>
                        {s.enabled ? <Pause className="imcrm-h-3.5 imcrm-w-3.5" /> : <Play className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {s.enabled ? __('Pausar') : __('Reanudar')}
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.isPending}
                        onClick={async () => {
                            const ok = await confirm({
                                title: __('¿Borrar esta sincronización?'),
                                description: __('Deja de traer datos. Lo que ya se cargó en la lista queda como está.'),
                                confirmLabel: __('Borrar'),
                                destructive: true,
                            });
                            if (ok) remove.mutate();
                        }}
                        aria-label={__('Borrar')}
                    >
                        <Trash2 className="imcrm-h-3.5 imcrm-w-3.5" />
                    </Button>
                </div>
            </div>

            {r && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-5 imcrm-gap-y-1 imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-3 imcrm-text-sm" data-testid="imcrm-sql-sync-result">
                    <Stat label={__('Leídas')} value={r.read} />
                    <Stat label={__('Creadas')} value={r.created} />
                    <Stat label={__('Actualizadas')} value={r.updated} />
                    <Stat label={__('Sin cambios')} value={r.unchanged} />
                    {r.flagged > 0 && <Stat label={__('Ya no están en SQL')} value={r.flagged} />}
                    {r.failed > 0 && <Stat label={__('Con error')} value={r.failed} tone="error" />}
                    <span className="imcrm-text-xs imcrm-text-muted-foreground imcrm-self-center">{(r.elapsed_ms / 1000).toFixed(1)} s</span>
                </div>
            )}
            {st.last_error && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-3 imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-sql-sync-error">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                    {st.last_error}
                </p>
            )}
            {st.errors.length > 0 && (
                <div className="imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-2">
                    <button type="button" className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground" onClick={() => setShowErrors((v) => !v)}>
                        {showErrors ? __('Ocultar filas con error') : `${__('Ver filas con error')} (${st.errors.length})`}
                    </button>
                    {showErrors && (
                        <ul className="imcrm-mt-2 imcrm-space-y-1 imcrm-text-xs">
                            {st.errors.map((e, i) => (
                                <li key={i}>
                                    <span className="imcrm-font-medium">{e.key}</span> — {e.message}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}
            {preview.isError && <p className="imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-3 imcrm-text-sm imcrm-text-destructive">{errText(preview.error)}</p>}
            {dry && <DryRunPanel dry={dry} onClose={() => setDry(null)} />}
        </section>
    );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'error' }): JSX.Element {
    return (
        <span className={cn(tone === 'error' && 'imcrm-text-destructive')}>
            <span className="imcrm-font-semibold">{formatNumber(value)}</span> <span className="imcrm-text-muted-foreground">{label}</span>
        </span>
    );
}

function DryRunPanel({ dry, onClose }: { dry: SqlSyncDryRun; onClose: () => void }): JSX.Element {
    const r = dry.result;
    return (
        <div className="imcrm-space-y-3 imcrm-border-t imcrm-border-border imcrm-bg-muted/30 imcrm-px-4 imcrm-py-3" data-testid="imcrm-sql-sync-dry-panel">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <p className="imcrm-flex-1 imcrm-text-sm imcrm-font-medium">
                    {__('Si corriera ahora')}: {formatNumber(r.created)} {__('nuevos')}, {formatNumber(r.updated)} {__('actualizados')}, {formatNumber(r.unchanged)}{' '}
                    {__('sin cambios')}
                    {r.failed > 0 && `, ${formatNumber(r.failed)} ${__('con error')}`}
                    {r.flagged > 0 && `, ${formatNumber(r.flagged)} ${__('marcados como «ya no está»')}`}.
                </p>
                <Button size="icon" variant="ghost" onClick={onClose} aria-label={__('Cerrar')}>
                    <X className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('No se escribió nada: es sólo lo que haría la próxima corrida.')}</p>
            {dry.sample.length > 0 && (
                <ul className="imcrm-space-y-2 imcrm-text-xs">
                    {dry.sample.map((s, i) => (
                        <li key={i} className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2">
                            <p className="imcrm-font-medium">
                                {s.key} · {s.action === 'create' ? __('nuevo') : __('cambia')}
                            </p>
                            <p className="imcrm-mt-0.5 imcrm-text-muted-foreground">
                                {s.changes.map((c) => (s.action === 'create' ? `${c.label}: ${c.after}` : `${c.label}: ${c.before} → ${c.after}`)).join(' · ')}
                            </p>
                        </li>
                    ))}
                </ul>
            )}
            {dry.errors.length > 0 && (
                <ul className="imcrm-space-y-1 imcrm-text-xs imcrm-text-destructive">
                    {dry.errors.slice(0, 10).map((e, i) => (
                        <li key={i}>
                            {e.key} — {e.message}
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ── Editor ──────────────────────────────────────────────────────────────

const NEW_FLAG = -1;

function SyncEditor({ connectionId, sync, onClose }: { connectionId: number; sync: SqlSync | null; onClose: () => void }): JSX.Element {
    const qc = useQueryClient();
    const lists = useLists();
    const tz = browserTimeZone();
    const [name, setName] = useState(sync?.name ?? '');
    const [kind, setKind] = useState<'query' | 'procedure'>(sync?.source.kind ?? 'query');
    const [query, setQuery] = useState(sync?.source.kind === 'query' ? sync.source.sql : 'SELECT *\nFROM dbo.Facturas\n-- Sólo lo que cambió desde la última vez:\n-- WHERE FechaModificacion >= @ultima_sincronizacion OR @ultima_sincronizacion IS NULL');
    const [procName, setProcName] = useState(sync?.source.kind === 'procedure' ? sync.source.name : '');
    const [params, setParams] = useState<SqlProcedureParam[]>(sync?.source.kind === 'procedure' ? sync.source.params : []);
    const [preview, setPreview] = useState<SqlPreviewResult | null>(null);
    const [listId, setListId] = useState<number>(sync?.list_id ?? 0);
    const [keyColumn, setKeyColumn] = useState(sync?.key_column ?? '');
    const [keyField, setKeyField] = useState<number>(sync?.key_field_id ?? 0);
    const [targets, setTargets] = useState<Record<string, ColumnTarget>>(() =>
        Object.fromEntries((sync?.columns ?? []).map((c) => [c.column, { kind: 'field', id: c.field_id } as ColumnTarget])),
    );
    const [createMissing, setCreateMissing] = useState(sync?.create_missing ?? true);
    const [nullClears, setNullClears] = useState(sync?.null_clears ?? true);
    const [onMissing, setOnMissing] = useState<'ignore' | 'flag'>(sync?.on_missing ?? 'ignore');
    const [flagField, setFlagField] = useState<number>(sync?.flag_field_id ?? NEW_FLAG);
    const [dateTz, setDateTz] = useState(sync?.date_timezone ?? tz);
    const [timeout, setTimeoutSecs] = useState(sync?.timeout_seconds ?? 60);
    const [schedule, setSchedule] = useState<SqlSyncSchedule>(sync?.schedule ?? { kind: 'interval', minutes: 60 });
    const [enabled, setEnabled] = useState(sync?.enabled ?? true);
    const [error, setError] = useState<string | null>(null);

    const fields = useFields(listId > 0 ? listId : undefined);
    const fieldList = useMemo(() => (fields.data ?? []).map((f) => ({ id: f.id, label: f.label, slug: f.slug, type: f.type as string })), [fields.data]);
    const tzOptions = useMemo(() => (EVENT_TIMEZONES.some((t) => t.value === tz) ? EVENT_TIMEZONES : [{ value: tz, label: tz }, ...EVENT_TIMEZONES]), [tz]);

    const source = () =>
        kind === 'query'
            ? { kind: 'query' as const, sql: query }
            : { kind: 'procedure' as const, name: procName.trim(), params: params.filter((p) => p.name.trim() !== '') };

    const test = useMutation({
        mutationFn: () => api.sqlPreview(connectionId, { source: source(), timeout_seconds: timeout }),
        onSuccess: (res) => {
            setPreview(res);
            setError(null);
            const key = keyColumn !== '' && res.columns.some((c) => c.name === keyColumn) ? keyColumn : suggestKeyColumn(res.columns, res.rows);
            setKeyColumn(key);
            setTargets(suggestTargets(res.columns, fieldList, key, sync?.columns ?? []));
            setKeyField((prev) => (prev > 0 ? prev : (matchField(key, keyFields(fieldList))?.id ?? 0)));
        },
        onError: (err) => setError(errText(err)),
    });

    // Al elegir otra lista (o cuando llegan sus campos) se vuelve a sugerir el
    // destino de cada columna contra los campos de ESA lista: elegir la lista
    // después de «Probar» no puede dejar el mapeo vacío.
    const fieldsKey = fieldList.map((f) => f.id).join(',');
    useEffect(() => {
        if (!preview || listId <= 0) return;
        setTargets(suggestTargets(preview.columns, fieldList, keyColumn, sync?.columns ?? []));
        setKeyField((prev) => (prev > 0 ? prev : (matchField(keyColumn, keyFields(fieldList))?.id ?? 0)));
        // Sólo cuando cambia la lista o sus campos, no en cada tecla.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listId, fieldsKey]);

    /** Otra columna clave: la anterior vuelve al mapeo con su sugerencia y se conserva lo ya elegido. */
    const changeKeyColumn = (key: string): void => {
        setKeyColumn(key);
        if (preview) {
            setTargets((prev) => {
                const chosen = Object.entries(prev)
                    .filter(([c, t]) => c !== key && t.kind === 'field')
                    .map(([column, t]) => ({ column, field_id: (t as { kind: 'field'; id: number }).id }));
                const fresh = suggestTargets(preview.columns, fieldList, key, chosen);
                const kept = Object.fromEntries(Object.entries(prev).filter(([c, t]) => c !== key && t.kind !== 'field'));
                return { ...fresh, ...kept };
            });
        }
        setKeyField((prev) => (prev > 0 ? prev : (matchField(key, keyFields(fieldList))?.id ?? 0)));
    };

    // Columnas conocidas: las de la prueba o, al editar sin probar, las guardadas.
    const columns = preview?.columns.map((c) => c.name) ?? [...new Set([sync?.key_column ?? '', ...(sync?.columns ?? []).map((c) => c.column)])].filter(Boolean);

    const save = useMutation({
        mutationFn: async () => {
            if (listId <= 0) throw new Error(__('Elegí la lista donde cargar los datos.'));
            if (keyColumn === '') throw new Error(__('Elegí la columna clave.'));
            // Los campos nuevos se crean primero (la sincronización guarda ids).
            const created: Record<string, number> = {};
            let key = keyField;
            if (key === 0) {
                const f = await api.createField(listId, { label: keyColumn, type: 'text' });
                key = f.id;
            }
            const cols: Array<{ column: string; field_id: number }> = [];
            for (const [column, t] of Object.entries(targets)) {
                if (column === keyColumn || !columns.includes(column)) continue;
                if (t.kind === 'skip') continue;
                if (t.kind === 'field') {
                    cols.push({ column, field_id: t.id });
                    continue;
                }
                const f = await api.createField(listId, { label: column, type: t.type });
                created[column] = f.id;
                cols.push({ column, field_id: f.id });
            }
            let flag: number | null = null;
            if (onMissing === 'flag') {
                flag = flagField === NEW_FLAG ? (await api.createField(listId, { label: __('Está en SQL'), type: 'checkbox' })).id : flagField;
            }
            void qc.invalidateQueries({ queryKey: fieldsKeys.all });
            const input: CreateSqlSyncInput = {
                name: name.trim() || (lists.data?.find((l) => l.id === listId)?.name ?? 'SQL'),
                list_id: listId,
                source: source(),
                key_column: keyColumn,
                key_field_id: key,
                columns: cols,
                create_missing: createMissing,
                null_clears: nullClears,
                on_missing: onMissing,
                flag_field_id: flag,
                date_timezone: dateTz,
                timeout_seconds: timeout,
                schedule,
                enabled,
            };
            return sync ? api.sqlSyncUpdate(sync.id, input) : api.sqlSyncCreate(connectionId, input);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['sql-syncs', connectionId] });
            onClose();
        },
        onError: (err) => setError(errText(err)),
    });

    const incremental = sqlSourceIsIncremental(source());
    // Con una fuente incremental marcar lo que falta es imposible (lo que no
    // cambió tampoco aparece): si el usuario la vuelve incremental, se apaga.
    useEffect(() => {
        if (incremental && onMissing === 'flag') setOnMissing('ignore');
    }, [incremental, onMissing]);

    const usableKey = keyFields(fieldList);
    const usableValue = valueFields(fieldList);
    const checkboxes = fieldList.filter((f) => f.type === 'checkbox');

    return (
        <section className="imcrm-space-y-6 imcrm-rounded-lg imcrm-border imcrm-border-primary/40 imcrm-bg-card imcrm-p-4 sm:imcrm-p-5" data-testid="imcrm-sql-sync-editor">
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <h2 className="imcrm-flex-1 imcrm-text-base imcrm-font-semibold">{sync ? __('Editar sincronización') : __('Nueva sincronización')}</h2>
                <Button size="icon" variant="ghost" onClick={onClose} aria-label={__('Cerrar')}>
                    <X className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label htmlFor="sql-name">{__('Nombre')}</Label>
                <Input id="sql-name" value={name} placeholder={__('Facturas desde el ERP')} onChange={(e) => setName(e.target.value)} />
            </div>

            {/* 1. Qué traer */}
            <div className="imcrm-space-y-3">
                <h3 className="imcrm-text-sm imcrm-font-semibold">1. {__('Qué traer')}</h3>
                <div className="imcrm-flex imcrm-gap-2">
                    {(['query', 'procedure'] as const).map((k) => (
                        <Button key={k} size="sm" variant={kind === k ? 'default' : 'outline'} onClick={() => setKind(k)} data-testid={`imcrm-sql-kind-${k}`}>
                            {k === 'query' ? __('Una consulta') : __('Un procedimiento almacenado')}
                        </Button>
                    ))}
                </div>
                {kind === 'query' ? (
                    <div className="imcrm-space-y-1.5">
                        <Textarea
                            rows={6}
                            className="imcrm-font-mono imcrm-text-xs"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            data-testid="imcrm-sql-query"
                        />
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                            {__('Podés usar @ultima_sincronizacion (fecha y hora UTC de la última corrida, NULL la primera vez) para traer sólo lo que cambió. Corre en una transacción que se deshace: no puede modificar tu base.')}
                        </p>
                    </div>
                ) : (
                    <div className="imcrm-space-y-2">
                        <Input value={procName} placeholder="dbo.uspFacturasPendientes" onChange={(e) => setProcName(e.target.value)} data-testid="imcrm-sql-proc" />
                        {params.map((p, i) => (
                            <div key={i} className="imcrm-flex imcrm-gap-2">
                                <Input
                                    className="imcrm-w-40"
                                    value={p.name}
                                    placeholder="@desde"
                                    onChange={(e) => setParams((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                                />
                                <Input
                                    value={p.value}
                                    placeholder={__('Valor (vacío = NULL)')}
                                    onChange={(e) => setParams((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                                />
                                <Button size="icon" variant="ghost" onClick={() => setParams((prev) => prev.filter((_, j) => j !== i))} aria-label={__('Quitar')}>
                                    <X className="imcrm-h-4 imcrm-w-4" />
                                </Button>
                            </div>
                        ))}
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-2">
                            <Button size="sm" variant="outline" onClick={() => setParams((prev) => [...prev, { name: '', value: '' }])}>
                                <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                {__('Parámetro')}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setParams((prev) => [...prev, { name: '@desde', value: SQL_LAST_SYNC_TOKEN }])}>
                                {__('+ la última sincronización')}
                            </Button>
                        </div>
                    </div>
                )}
                <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate()} data-testid="imcrm-sql-test">
                    {test.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Play className="imcrm-h-3.5 imcrm-w-3.5" />}
                    {__('Probar')}
                </Button>
                {preview && <PreviewTable preview={preview} />}
            </div>

            {/* 2. Dónde cargarlo */}
            <div className="imcrm-space-y-3">
                <h3 className="imcrm-text-sm imcrm-font-semibold">2. {__('Dónde cargarlo')}</h3>
                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-3">
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label>{__('Lista')}</Label>
                        <Select
                            value={listId}
                            onChange={(e) => {
                                setListId(Number(e.target.value));
                                setKeyField(0);
                                setTargets({});
                            }}
                            data-testid="imcrm-sql-list"
                        >
                            <option value={0}>{__('Elegí una lista')}</option>
                            {(lists.data ?? []).map((l) => (
                                <option key={l.id} value={l.id}>
                                    {l.name}
                                </option>
                            ))}
                        </Select>
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label>{__('Columna clave en SQL')}</Label>
                        {columns.length > 0 ? (
                            <Select value={keyColumn} onChange={(e) => changeKeyColumn(e.target.value)} data-testid="imcrm-sql-key-column">
                                <option value="">{__('Elegí una columna')}</option>
                                {columns.map((c) => (
                                    <option key={c} value={c}>
                                        {c}
                                    </option>
                                ))}
                            </Select>
                        ) : (
                            <Input value={keyColumn} placeholder="NIT" onChange={(e) => setKeyColumn(e.target.value)} />
                        )}
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label>{__('…va al campo')}</Label>
                        <Select value={keyField} onChange={(e) => setKeyField(Number(e.target.value))} disabled={listId <= 0} data-testid="imcrm-sql-key-field">
                            <option value={0}>{keyColumn ? `${__('Crear campo')} «${keyColumn}»` : __('Crear campo nuevo')}</option>
                            {usableKey.map((f) => (
                                <option key={f.id} value={f.id}>
                                    {f.label}
                                </option>
                            ))}
                        </Select>
                    </div>
                </div>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Cada fila se empareja por la clave (NIT, número de factura): si el registro existe se actualiza, si no se crea. Nunca se duplica.')}
                </p>
                {listId > 0 && columns.filter((c) => c !== keyColumn).length > 0 && (
                    <div className="imcrm-overflow-x-auto imcrm-rounded-md imcrm-border imcrm-border-border">
                        <table className="imcrm-w-full imcrm-text-sm" data-testid="imcrm-sql-mapping">
                            <thead className="imcrm-bg-muted/40 imcrm-text-xs imcrm-text-muted-foreground">
                                <tr>
                                    <th className="imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-font-medium">{__('Columna en SQL')}</th>
                                    <th className="imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-font-medium">{__('Campo de la lista')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {columns
                                    .filter((c) => c !== keyColumn)
                                    .map((c) => {
                                        const t = targets[c] ?? { kind: 'skip' };
                                        const suggested = preview?.columns.find((p) => p.name === c)?.suggested_type ?? 'text';
                                        const value = t.kind === 'field' ? String(t.id) : t.kind === 'create' ? 'create' : 'skip';
                                        return (
                                            <tr key={c} className="imcrm-border-t imcrm-border-border">
                                                <td className="imcrm-px-3 imcrm-py-1.5 imcrm-font-mono imcrm-text-xs">{c}</td>
                                                <td className="imcrm-px-3 imcrm-py-1.5">
                                                    <Select
                                                        value={value}
                                                        onChange={(e) => {
                                                            const v = e.target.value;
                                                            setTargets((prev) => ({
                                                                ...prev,
                                                                [c]: v === 'skip' ? { kind: 'skip' } : v === 'create' ? { kind: 'create', type: t.kind === 'create' ? t.type : suggested } : { kind: 'field', id: Number(v) },
                                                            }));
                                                        }}
                                                        data-testid="imcrm-sql-map"
                                                        data-column={c}
                                                    >
                                                        <option value="skip">{__('No traer')}</option>
                                                        <option value="create">
                                                            {`${__('Crear campo')} «${c}» (${__(FIELD_TYPE_LABEL[t.kind === 'create' ? t.type : suggested] ?? 'Texto')})`}
                                                        </option>
                                                        {usableValue
                                                            .filter((f) => f.id !== keyField)
                                                            .map((f) => (
                                                                <option key={f.id} value={f.id}>
                                                                    {f.label} · {__(FIELD_TYPE_LABEL[f.type] ?? f.type)}
                                                                </option>
                                                            ))}
                                                    </Select>
                                                </td>
                                            </tr>
                                        );
                                    })}
                            </tbody>
                        </table>
                    </div>
                )}
                {listId > 0 && columns.length === 0 && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Tocá «Probar» para ver las columnas que devuelve la consulta y elegir a qué campo va cada una.')}</p>
                )}
            </div>

            {/* 3. Opciones */}
            <div className="imcrm-space-y-3">
                <h3 className="imcrm-text-sm imcrm-font-semibold">3. {__('Opciones')}</h3>
                <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                    <input type="checkbox" className="imcrm-mt-0.5" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
                    {__('Crear los registros cuya clave todavía no está en la lista')}
                </label>
                <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                    <input type="checkbox" className="imcrm-mt-0.5" checked={nullClears} onChange={(e) => setNullClears(e.target.checked)} />
                    {__('Un valor NULL en SQL vacía el campo (si no, se deja lo que había)')}
                </label>
                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label>{__('Lo que deja de aparecer en el resultado')}</Label>
                        <Select value={onMissing} onChange={(e) => setOnMissing(e.target.value as 'ignore' | 'flag')} data-testid="imcrm-sql-on-missing">
                            <option value="ignore">{__('No tocarlo')}</option>
                            <option value="flag" disabled={incremental}>
                                {__('Marcarlo en una casilla')}
                            </option>
                        </Select>
                        {incremental && (
                            <p className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-sql-incremental-note">
                                {__('La consulta usa @ultima_sincronizacion y sólo trae lo que cambió, así que no se puede saber qué dejó de existir.')}
                            </p>
                        )}
                    </div>
                    {onMissing === 'flag' && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label>{__('Casilla')}</Label>
                            <Select value={flagField} onChange={(e) => setFlagField(Number(e.target.value))} disabled={listId <= 0}>
                                <option value={NEW_FLAG}>{__('Crear «Está en SQL»')}</option>
                                {checkboxes.map((f) => (
                                    <option key={f.id} value={f.id}>
                                        {f.label}
                                    </option>
                                ))}
                            </Select>
                        </div>
                    )}
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label>{__('Zona horaria de las fechas de la base')}</Label>
                        <Select value={dateTz} onChange={(e) => setDateTz(e.target.value)}>
                            {tzOptions.map((t) => (
                                <option key={t.value} value={t.value}>
                                    {t.label}
                                </option>
                            ))}
                        </Select>
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label>{__('Tiempo máximo de la consulta (segundos)')}</Label>
                        <Input type="number" min={5} max={300} value={timeout} onChange={(e) => setTimeoutSecs(Math.min(300, Math.max(5, Number(e.target.value) || 60)))} />
                    </div>
                </div>
            </div>

            {/* 4. Cuándo */}
            <div className="imcrm-space-y-3">
                <h3 className="imcrm-text-sm imcrm-font-semibold">4. {__('Cuándo')}</h3>
                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                    <Select
                        value={schedule.kind === 'interval' ? String(schedule.minutes) : 'daily'}
                        onChange={(e) => {
                            const v = e.target.value;
                            setSchedule(v === 'daily' ? { kind: 'daily', time: '07:00', timezone: tz } : { kind: 'interval', minutes: Number(v) });
                        }}
                        data-testid="imcrm-sql-schedule"
                    >
                        {SQL_SYNC_INTERVALS.map((m) => (
                            <option key={m} value={m}>
                                {__(INTERVAL_LABEL[m] ?? `Cada ${m} minutos`)}
                            </option>
                        ))}
                        <option value="daily">{__('Todos los días a una hora')}</option>
                    </Select>
                    {schedule.kind === 'daily' && (
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <Input type="time" value={schedule.time} onChange={(e) => setSchedule({ ...schedule, time: e.target.value || '07:00' })} className="imcrm-w-32" />
                            <span className="imcrm-text-xs imcrm-text-muted-foreground">{schedule.timezone}</span>
                        </div>
                    )}
                </div>
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                    {sync ? __('Activa') : __('Activarla y correr la primera ahora')}
                </label>
                {!sync && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('La primera carga no dispara automatizaciones (para no mandar cientos de correos de golpe); las siguientes sí, con el valor anterior y el nuevo.')}
                    </p>
                )}
            </div>

            {error && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-sql-editor-error">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                    {error}
                </p>
            )}
            <div className="imcrm-flex imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-4">
                <Button variant="ghost" onClick={onClose}>
                    {__('Cancelar')}
                </Button>
                <Button disabled={save.isPending} onClick={() => save.mutate()} data-testid="imcrm-sql-save">
                    {save.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <CheckCircle2 className="imcrm-h-4 imcrm-w-4" />}
                    {__('Guardar')}
                </Button>
            </div>
        </section>
    );
}

function PreviewTable({ preview }: { preview: SqlPreviewResult }): JSX.Element {
    return (
        <div className="imcrm-space-y-1.5" data-testid="imcrm-sql-preview">
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {preview.columns.length} {__('columnas')} · {preview.rows.length}
                {preview.more ? '+' : ''} {__('filas de muestra')} · {(preview.elapsed_ms / 1000).toFixed(1)} s
            </p>
            <div className="imcrm-max-h-64 imcrm-overflow-auto imcrm-rounded-md imcrm-border imcrm-border-border">
                <table className="imcrm-w-full imcrm-text-xs">
                    <thead className="imcrm-sticky imcrm-top-0 imcrm-bg-muted">
                        <tr>
                            {preview.columns.map((c) => (
                                <th key={c.name} className="imcrm-whitespace-nowrap imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-font-medium">
                                    {c.name}
                                    <span className="imcrm-ml-1 imcrm-font-normal imcrm-text-muted-foreground">{c.sql_type}</span>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {preview.rows.map((r, i) => (
                            <tr key={i} className="imcrm-border-t imcrm-border-border">
                                {preview.columns.map((c) => (
                                    <td key={c.name} className="imcrm-max-w-[16rem] imcrm-truncate imcrm-whitespace-nowrap imcrm-px-2 imcrm-py-1">
                                        {r[c.name] ?? <span className="imcrm-text-muted-foreground">NULL</span>}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
