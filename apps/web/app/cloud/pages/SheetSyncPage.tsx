import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import {
    SHEET_DIRECTION_LABELS,
    SHEET_SYNC_ID_COLUMN,
    SHEET_SYNC_INTERVALS,
    SHEET_SYNC_KEY_TYPES,
    describeSheetInterval,
    sheetSyncReadsSheet,
    sheetSyncWritesSheet,
    spreadsheetUrl,
    type CreateSheetSyncInput,
    type SheetPreviewResult,
    type SheetSync,
    type SheetSyncDirection,
    type SheetSyncDryRun,
    type SheetSyncKey,
} from '@imagina-base/shared';
import {
    AlertTriangle,
    ArrowLeft,
    CheckCircle2,
    ExternalLink,
    Eye,
    FileSpreadsheet,
    Loader2,
    Pause,
    Pencil,
    Play,
    Plus,
    RefreshCw,
    Trash2,
    X,
} from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';
import { api } from '@/cloud/session';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { fieldsKeys, useFields } from '@/hooks/useFields';
import { useLists } from '@/hooks/useLists';
import { CloudApiError } from '@/lib/cloud/client';
import { __ } from '@/lib/i18n';
import { formatDateTimeStr, formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import {
    fieldsWithoutColumn,
    newColumnName,
    sheetKeyFields,
    sheetValueFields,
    suggestSheetKey,
    suggestSheetTargets,
    type SheetColumnTarget,
    type SheetFieldLike,
} from './sheetSyncForm';
import { FIELD_TYPE_LABEL, normalizeName } from './sqlSyncForm';

/**
 * Sincronizar una lista con una pestaña de Google Sheets (v0.1.459). Cada
 * sincronización une una pestaña con una lista, en uno o en los dos sentidos,
 * por una columna clave. El trabajo corre en segundo plano; esta pantalla
 * pregunta el estado seguido mientras hay una corrida en curso.
 */

const DIRECTION_HELP: Record<SheetSyncDirection, string> = {
    both: 'Lo que cambia en la hoja llega a la lista y lo que cambia en la lista llega a la hoja. Si la misma celda cambió en los dos lados, gana la app.',
    sheet_to_app: 'La hoja manda: la lista se pone igual a la hoja. Nada se escribe en la hoja.',
    app_to_sheet: 'La lista manda: la hoja se pone igual a la lista (una copia que se mantiene sola). Lo que se cambie a mano en la hoja se reemplaza.',
};

function errText(err: unknown): string {
    if (err instanceof CloudApiError) return err.message;
    return err instanceof Error ? err.message : String(err);
}

export function SheetSyncPage(): JSX.Element {
    const { connectionId } = useParams();
    const id = Number(connectionId);
    const [editing, setEditing] = useState<SheetSync | 'new' | null>(null);

    const connections = useQuery({ queryKey: ['connections'], queryFn: () => api.connectionsList(), retry: false });
    const conn = connections.data?.find((c) => c.id === id) ?? null;
    const syncs = useQuery({
        queryKey: ['sheet-syncs', id],
        queryFn: () => api.sheetSyncs(id),
        enabled: Number.isInteger(id) && id > 0,
        retry: false,
        refetchInterval: (q) => ((q.state.data ?? []).some((s) => s.status.running || s.status.queued) ? 2000 : 30_000),
    });

    return (
        <div className="imcrm-mx-auto imcrm-max-w-4xl imcrm-space-y-6 imcrm-p-4 sm:imcrm-p-6" data-testid="imcrm-sheet-sync">
            <Link
                to="/settings?s=conectores"
                className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-sm imcrm-text-muted-foreground hover:imcrm-text-foreground"
            >
                <ArrowLeft className="imcrm-h-4 imcrm-w-4" />
                {__('Integraciones')}
            </Link>
            <header className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-3">
                <IntegrationLogo integrationKey="google_sheets" size={44} />
                {/* Ancho mínimo: en el celular el botón baja de renglón en vez de aplastar el título. */}
                <div className="imcrm-min-w-[12rem] imcrm-flex-1">
                    <h1 className="imcrm-break-words imcrm-text-xl imcrm-font-semibold">{conn?.custom_name ? conn.name : (conn?.account_label ?? __('Google Sheets'))}</h1>
                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Une una pestaña de tu planilla con una lista: lo que cambia en un lado llega al otro, sin duplicar.')}
                    </p>
                </div>
                {editing === null && (
                    <Button onClick={() => setEditing('new')} data-testid="imcrm-sheet-sync-new" data-tour="sheet-sync-new">
                        <Plus className="imcrm-h-4 imcrm-w-4" />
                        {__('Nueva sincronización')}
                    </Button>
                )}
            </header>

            {syncs.isError && <p className="imcrm-text-sm imcrm-text-destructive">{errText(syncs.error)}</p>}

            {editing !== null && <SyncEditor connectionId={id} sync={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}

            {syncs.isLoading ? (
                <div className="imcrm-flex imcrm-h-32 imcrm-items-center imcrm-justify-center">
                    <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />
                </div>
            ) : (syncs.data ?? []).length === 0 && editing === null ? (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-8 imcrm-text-center">
                    <FileSpreadsheet className="imcrm-mx-auto imcrm-h-8 imcrm-w-8 imcrm-text-muted-foreground" />
                    <p className="imcrm-mt-3 imcrm-text-sm imcrm-font-medium">{__('Todavía no hay sincronizaciones')}</p>
                    <p className="imcrm-mt-1 imcrm-text-sm imcrm-text-muted-foreground">
                        {__('Pega el enlace de una planilla, elige la pestaña, la lista y qué columna va a qué campo.')}
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

function SyncCard({ sync: s, connectionId, onEdit }: { sync: SheetSync; connectionId: number; onEdit: () => void }): JSX.Element {
    const qc = useQueryClient();
    const confirm = useConfirm();
    const [dry, setDry] = useState<SheetSyncDryRun | null>(null);
    const [showErrors, setShowErrors] = useState(false);
    const [showConflicts, setShowConflicts] = useState(false);
    const refresh = (): void => void qc.invalidateQueries({ queryKey: ['sheet-syncs', connectionId] });

    const run = useMutation({ mutationFn: () => api.sheetSyncRun(s.id), onSuccess: refresh });
    const toggle = useMutation({ mutationFn: () => api.sheetSyncUpdate(s.id, { enabled: !s.enabled }), onSuccess: refresh });
    const preview = useMutation({ mutationFn: () => api.sheetSyncDryRun(s.id), onSuccess: setDry });
    const remove = useMutation({ mutationFn: () => api.sheetSyncRemove(s.id), onSuccess: refresh });

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
    ) : st.last_error ? (
        <Badge variant="warning">{__('Con avisos')}</Badge>
    ) : st.last_run_at ? (
        <Badge variant="success">{__('Al día')}</Badge>
    ) : (
        <Badge variant="outline">{__('Todavía no corrió')}</Badge>
    );

    return (
        <section className="imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card" data-testid="imcrm-sheet-sync-card" data-sync={s.id} data-tour="sheet-sync-card">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-start imcrm-gap-3 imcrm-p-4">
                <div className="imcrm-min-w-0 imcrm-flex-1">
                    <p className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-font-medium">
                        <span className="imcrm-min-w-0 imcrm-break-words">{s.name}</span>
                        {badge}
                    </p>
                    <p className="imcrm-mt-0.5 imcrm-break-words imcrm-text-sm imcrm-text-muted-foreground">
                        <a
                            href={s.spreadsheet_url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-underline-offset-2 hover:imcrm-underline"
                            data-testid="imcrm-sheet-sync-open-sheet"
                        >
                            {s.spreadsheet_title || __('Planilla')} › {s.sheet_title}
                            <ExternalLink className="imcrm-h-3 imcrm-w-3" />
                        </a>
                        {s.direction === 'sheet_to_app' ? ' → ' : s.direction === 'app_to_sheet' ? ' ← ' : ' ↔ '}
                        {s.list_slug ? (
                            <Link to={`/lists/${s.list_slug}`} className="imcrm-underline-offset-2 hover:imcrm-underline">
                                {s.list_name}
                            </Link>
                        ) : (
                            __('(lista borrada)')
                        )}
                    </p>
                    <p className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                        {__(SHEET_DIRECTION_LABELS[s.direction])} · {__('clave')} «{s.key.column}» · {__(describeSheetInterval(s.interval_minutes))} ·{' '}
                        {formatNumber(s.linked)} {__('registros unidos')}
                    </p>
                    <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                        {st.last_run_at ? `${__('Última corrida')}: ${formatDateTimeStr(st.last_run_at)}` : __('Todavía no corrió.')}
                        {st.next_run_at && ` · ${__('Próxima')}: ${formatDateTimeStr(st.next_run_at)}`}
                    </p>
                </div>
                <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-1">
                    <Button size="sm" variant="outline" disabled={run.isPending || st.running} onClick={() => run.mutate()} data-testid="imcrm-sheet-sync-run">
                        <RefreshCw className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Sincronizar ahora')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={preview.isPending} onClick={() => preview.mutate()} data-testid="imcrm-sheet-sync-dry">
                        {preview.isPending ? <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" /> : <Eye className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {__('Probar')}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={onEdit} data-testid="imcrm-sheet-sync-edit">
                        <Pencil className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Editar')}
                    </Button>
                    <Button size="sm" variant="ghost" disabled={toggle.isPending} onClick={() => toggle.mutate()} data-testid="imcrm-sheet-sync-toggle">
                        {s.enabled ? <Pause className="imcrm-h-3.5 imcrm-w-3.5" /> : <Play className="imcrm-h-3.5 imcrm-w-3.5" />}
                        {s.enabled ? __('Pausar') : __('Reanudar')}
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        disabled={remove.isPending}
                        data-testid="imcrm-sheet-sync-remove"
                        onClick={async () => {
                            const ok = await confirm({
                                title: __('¿Borrar esta sincronización?'),
                                description: __('Deja de sincronizar. Lo que ya está en la lista y en la hoja queda como está.'),
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
                <div
                    className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-5 imcrm-gap-y-1 imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-3 imcrm-text-sm"
                    data-testid="imcrm-sheet-sync-result"
                >
                    <Stat label={__('Filas leídas')} value={r.read} />
                    <Stat label={__('Creados')} value={r.created} />
                    <Stat label={__('Actualizados')} value={r.updated} />
                    <Stat label={__('Celdas escritas en la hoja')} value={r.cells_written} />
                    {r.rows_added > 0 && <Stat label={__('Filas agregadas')} value={r.rows_added} />}
                    {r.rows_deleted > 0 && <Stat label={__('Filas borradas')} value={r.rows_deleted} />}
                    {r.trashed > 0 && <Stat label={__('A la papelera')} value={r.trashed} />}
                    <Stat label={__('Sin cambios')} value={r.unchanged} />
                    {r.conflicts > 0 && <Stat label={__('Conflictos')} value={r.conflicts} tone="warning" />}
                    {r.failed > 0 && <Stat label={__('Con error')} value={r.failed} tone="error" />}
                    <span className="imcrm-self-center imcrm-text-xs imcrm-text-muted-foreground">{(r.elapsed_ms / 1000).toFixed(1)} s</span>
                </div>
            )}
            {st.last_error && (
                <p
                    className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-3 imcrm-text-sm imcrm-text-destructive"
                    data-testid="imcrm-sheet-sync-error"
                >
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                    <span className="imcrm-min-w-0 imcrm-whitespace-pre-wrap imcrm-break-words">{st.last_error}</span>
                </p>
            )}
            {st.notes.length > 0 && (
                <ul className="imcrm-space-y-1 imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-2 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-sheet-sync-notes">
                    {st.notes.map((n, i) => (
                        <li key={i} className="imcrm-break-words">
                            {n}
                        </li>
                    ))}
                </ul>
            )}
            {st.conflicts.length > 0 && (
                <div className="imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-2">
                    <button
                        type="button"
                        className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground"
                        onClick={() => setShowConflicts((v) => !v)}
                        data-testid="imcrm-sheet-sync-conflicts-toggle"
                    >
                        {showConflicts ? __('Ocultar conflictos') : `${__('Ver conflictos')} (${st.conflicts.length})`}
                    </button>
                    {showConflicts && (
                        <div className="imcrm-mt-2 imcrm-space-y-2 imcrm-text-xs" data-testid="imcrm-sheet-sync-conflicts">
                            <p className="imcrm-text-muted-foreground">
                                {__('Estas celdas cambiaron en la hoja y en la app desde la última sincronización. Quedó el valor de la app y se reemplazó el de la hoja. Si querías el de la hoja, escríbelo de nuevo en la lista.')}
                            </p>
                            <ul className="imcrm-space-y-1">
                                {st.conflicts.map((c, i) => (
                                    <li key={i} className="imcrm-break-words">
                                        <span className="imcrm-font-medium">{c.where}</span> · {c.field}: {__('quedó')} «{c.kept || '—'}», {__('se reemplazó')} «{c.replaced || '—'}»
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
            {st.errors.length > 0 && (
                <div className="imcrm-border-t imcrm-border-border imcrm-px-4 imcrm-py-2">
                    <button
                        type="button"
                        className="imcrm-text-xs imcrm-text-muted-foreground hover:imcrm-text-foreground"
                        onClick={() => setShowErrors((v) => !v)}
                        data-testid="imcrm-sheet-sync-errors-toggle"
                    >
                        {showErrors ? __('Ocultar filas con error') : `${__('Ver filas con error')} (${st.errors.length})`}
                    </button>
                    {showErrors && (
                        <ul className="imcrm-mt-2 imcrm-space-y-1 imcrm-text-xs" data-testid="imcrm-sheet-sync-errors">
                            {st.errors.map((e, i) => (
                                <li key={i} className="imcrm-break-words">
                                    <span className="imcrm-font-medium">{e.where}</span> — {e.message}
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

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'error' | 'warning' }): JSX.Element {
    return (
        <span className={cn(tone === 'error' && 'imcrm-text-destructive', tone === 'warning' && 'imcrm-text-[hsl(var(--imcrm-warning-ink))]')}>
            <span className="imcrm-font-semibold">{formatNumber(value)}</span> <span className="imcrm-text-muted-foreground">{label}</span>
        </span>
    );
}

const SAMPLE_LABEL: Record<SheetSyncDryRun['sample'][number]['action'], string> = {
    create: 'registro nuevo',
    update: 'cambia en la lista',
    write_sheet: 'cambia en la hoja',
    add_row: 'fila nueva en la hoja',
    delete_row: 'se borra la fila',
    trash: 'a la papelera',
};

function DryRunPanel({ dry, onClose }: { dry: SheetSyncDryRun; onClose: () => void }): JSX.Element {
    const r = dry.result;
    return (
        <div className="imcrm-space-y-3 imcrm-border-t imcrm-border-border imcrm-bg-muted/30 imcrm-px-4 imcrm-py-3" data-testid="imcrm-sheet-sync-dry-panel">
            <div className="imcrm-flex imcrm-items-start imcrm-gap-2">
                <p className="imcrm-flex-1 imcrm-text-sm imcrm-font-medium">
                    {__('Si corriera ahora')}: {formatNumber(r.created)} {__('nuevos en la lista')}, {formatNumber(r.updated)} {__('actualizados')},{' '}
                    {formatNumber(r.cells_written)} {__('celdas en la hoja')}, {formatNumber(r.rows_added)} {__('filas nuevas en la hoja')}
                    {r.rows_deleted > 0 && `, ${formatNumber(r.rows_deleted)} ${__('filas borradas')}`}
                    {r.trashed > 0 && `, ${formatNumber(r.trashed)} ${__('a la papelera')}`}
                    {r.failed > 0 && `, ${formatNumber(r.failed)} ${__('con error')}`}.
                </p>
                <Button size="icon" variant="ghost" onClick={onClose} aria-label={__('Cerrar')}>
                    <X className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </div>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('No se escribió nada, ni en la lista ni en la hoja: es sólo lo que haría la próxima corrida.')}</p>
            {dry.sample.length > 0 && (
                <ul className="imcrm-space-y-2 imcrm-text-xs">
                    {dry.sample.map((s, i) => (
                        <li key={i} className="imcrm-break-words imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-2">
                            <p className="imcrm-font-medium">
                                {s.where} · {__(SAMPLE_LABEL[s.action])}
                            </p>
                            {s.changes.length > 0 && (
                                <p className="imcrm-mt-0.5 imcrm-text-muted-foreground">
                                    {s.changes.map((c) => (c.before === '' || c.before === '—' ? `${c.label}: ${c.after}` : `${c.label}: ${c.before} → ${c.after}`)).join(' · ')}
                                </p>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {dry.errors.length > 0 && (
                <ul className="imcrm-space-y-1 imcrm-text-xs imcrm-text-destructive">
                    {dry.errors.slice(0, 10).map((e, i) => (
                        <li key={i} className="imcrm-break-words">
                            {e.where} — {e.message}
                        </li>
                    ))}
                </ul>
            )}
            {dry.notes.length > 0 && (
                <ul className="imcrm-space-y-1 imcrm-text-xs imcrm-text-muted-foreground">
                    {dry.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}

// ── Editor ──────────────────────────────────────────────────────────────

const CREATE_KEY_FIELD = 0;

function SyncEditor({ connectionId, sync, onClose }: { connectionId: number; sync: SheetSync | null; onClose: () => void }): JSX.Element {
    const qc = useQueryClient();
    const lists = useLists();
    const [name, setName] = useState(sync?.name ?? '');
    const [link, setLink] = useState(sync ? spreadsheetUrl(sync.spreadsheet_id, sync.sheet_gid) : '');
    const [preview, setPreview] = useState<SheetPreviewResult | null>(null);
    const [gid, setGid] = useState<number | null>(sync?.sheet_gid ?? null);
    const [headerRow, setHeaderRow] = useState(sync?.header_row ?? 1);
    const [listId, setListId] = useState<number>(sync?.list_id ?? 0);
    const [key, setKey] = useState<SheetSyncKey>(sync?.key ?? { mode: 'app_id', column: SHEET_SYNC_ID_COLUMN });
    const [keyCreate, setKeyCreate] = useState(false);
    const [targets, setTargets] = useState<Record<string, SheetColumnTarget>>(() =>
        Object.fromEntries((sync?.columns ?? []).map((c) => [c.column, { kind: 'field', id: c.field_id } as SheetColumnTarget])),
    );
    const [extra, setExtra] = useState<Set<number>>(new Set());
    const [direction, setDirection] = useState<SheetSyncDirection>(sync?.direction ?? 'both');
    const [onSheetDelete, setOnSheetDelete] = useState(sync?.on_sheet_delete ?? 'ignore');
    const [onAppDelete, setOnAppDelete] = useState(sync?.on_app_delete ?? 'ignore');
    const [interval, setIntervalMinutes] = useState(sync?.interval_minutes ?? 15);
    const [enabled, setEnabled] = useState(sync?.enabled ?? true);
    const [error, setError] = useState<string | null>(null);

    const fields = useFields(listId > 0 ? listId : undefined);
    const fieldList: SheetFieldLike[] = useMemo(
        () => (fields.data ?? []).map((f) => ({ id: f.id, label: f.label, slug: f.slug, type: f.type as string, is_unique: f.is_unique })),
        [fields.data],
    );

    const open = useMutation({
        mutationFn: (opts: { gid?: number | null; headerRow?: number }) =>
            api.sheetPreview(connectionId, {
                spreadsheet: link,
                ...(opts.gid !== undefined && opts.gid !== null ? { sheet_gid: opts.gid } : {}),
                header_row: opts.headerRow ?? headerRow,
            }),
        onSuccess: (res) => {
            setPreview(res);
            setGid(res.sheet_gid);
            setError(null);
            if (!sync && name.trim() === '') setName(res.sheet_title && res.spreadsheet_title ? `${res.spreadsheet_title} · ${res.sheet_title}` : res.spreadsheet_title);
        },
        onError: (err) => setError(errText(err)),
    });

    // Al abrir la planilla o elegir la lista: clave y destino sugeridos contra
    // los campos de ESA lista (lo guardado, al editar, se conserva).
    const fieldsKey = fieldList.map((f) => f.id).join(',');
    const previewKey = preview ? `${preview.spreadsheet_id}:${preview.sheet_gid}:${preview.header_row}:${preview.columns.map((c) => c.name).join('|')}` : '';
    // Sin los campos cargados, todo saldría «Crear campo»: se espera (si no, un
    // «Guardar» rápido crearía campos repetidos con el mismo nombre).
    const fieldsReady = listId > 0 && fields.data !== undefined;
    useEffect(() => {
        if (!preview || !fieldsReady) return;
        const k = sync && sync.list_id === listId ? key : suggestSheetKey(preview.columns, preview.rows, fieldList);
        setKey(k);
        setKeyCreate(false);
        setTargets(suggestSheetTargets(preview.columns, fieldList, k, sync && sync.list_id === listId ? sync.columns : []));
        setExtra(new Set());
        // Sólo cuando cambia la planilla, la lista o sus campos (no en cada cambio de la clave).
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [listId, fieldsKey, previewKey, fieldsReady]);

    const sheetColumns = preview?.columns.map((c) => c.name) ?? [...new Set([...(sync?.columns ?? []).map((c) => c.column), ...(key.mode === 'field' ? [key.column] : [])])];
    const dataColumns = sheetColumns.filter((c) => c !== key.column);
    const usableKey = sheetKeyFields(fieldList);
    const usableValue = sheetValueFields(fieldList);
    const writes = sheetSyncWritesSheet(direction);
    const reads = sheetSyncReadsSheet(direction);
    const missing = listId > 0 ? fieldsWithoutColumn(fieldList, targets, key) : [];

    /** Otra columna clave: la anterior vuelve a ser una columna de datos con su sugerencia. */
    const changeKey = (next: SheetSyncKey): void => {
        setKey(next);
        setKeyCreate(false);
        if (preview) {
            setTargets((prev) => {
                const chosen = Object.entries(prev)
                    .filter(([c, t]) => c !== next.column && t.kind === 'field')
                    .map(([column, t]) => ({ column, field_id: (t as { kind: 'field'; id: number }).id }))
                    .filter((m) => next.mode !== 'field' || m.field_id !== next.field_id);
                return suggestSheetTargets(preview.columns, fieldList, next, chosen);
            });
        }
    };

    const save = useMutation({
        mutationFn: async () => {
            if (!preview && !sync) throw new Error(__('Abre la planilla primero (pega el enlace y toca «Abrir»).'));
            if (listId <= 0) throw new Error(__('Elige la lista.'));
            const sheetId = preview?.spreadsheet_id ?? sync!.spreadsheet_id;
            const sheetGid = gid ?? preview?.sheet_gid ?? sync!.sheet_gid;
            let finalKey: SheetSyncKey = key;
            if (key.mode === 'field' && (keyCreate || key.field_id <= 0)) {
                if (key.column.trim() === '') throw new Error(__('Elige la columna clave.'));
                const suggested = preview?.columns.find((c) => c.name === key.column)?.suggested_type ?? 'text';
                const type = (SHEET_SYNC_KEY_TYPES as readonly string[]).includes(suggested) ? suggested : 'text';
                const f = await api.createField(listId, { label: key.column, type: type as 'text' });
                finalKey = { mode: 'field', column: key.column, field_id: f.id };
            }
            const cols: Array<{ column: string; field_id: number }> = [];
            for (const column of dataColumns) {
                const t = targets[column] ?? { kind: 'skip' };
                if (t.kind === 'skip') continue;
                if (t.kind === 'field') {
                    cols.push({ column, field_id: t.id });
                    continue;
                }
                const f = await api.createField(listId, { label: column, type: t.type });
                cols.push({ column, field_id: f.id });
            }
            // Campos de la lista que todavía no están en la hoja: la app agrega su columna.
            const taken = [...sheetColumns, key.column];
            for (const f of missing) {
                if (!extra.has(f.id)) continue;
                const column = newColumnName(f.label, taken);
                taken.push(column);
                cols.push({ column, field_id: f.id });
            }
            void qc.invalidateQueries({ queryKey: fieldsKeys.all });
            const input: CreateSheetSyncInput = {
                name: name.trim() || (lists.data?.find((l) => l.id === listId)?.name ?? 'Google Sheets'),
                list_id: listId,
                spreadsheet_id: sheetId,
                sheet_gid: sheetGid,
                header_row: headerRow,
                direction,
                key: finalKey,
                columns: cols,
                on_sheet_delete: reads ? onSheetDelete : 'ignore',
                on_app_delete: writes ? onAppDelete : 'ignore',
                interval_minutes: interval,
                enabled,
            };
            return sync ? api.sheetSyncUpdate(sync.id, input) : api.sheetSyncCreate(connectionId, input);
        },
        onSuccess: () => {
            void qc.invalidateQueries({ queryKey: ['sheet-syncs', connectionId] });
            onClose();
        },
        onError: (err) => setError(errText(err)),
    });

    return (
        <section
            className="imcrm-space-y-6 imcrm-rounded-lg imcrm-border imcrm-border-primary/40 imcrm-bg-card imcrm-p-4 sm:imcrm-p-5"
            data-testid="imcrm-sheet-sync-editor"
        >
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <h2 className="imcrm-flex-1 imcrm-text-base imcrm-font-semibold">{sync ? __('Editar sincronización') : __('Nueva sincronización')}</h2>
                <Button size="icon" variant="ghost" onClick={onClose} aria-label={__('Cerrar')}>
                    <X className="imcrm-h-4 imcrm-w-4" />
                </Button>
            </div>

            {/* 1. La hoja */}
            <div className="imcrm-space-y-3">
                <h3 className="imcrm-text-sm imcrm-font-semibold">1. {__('La hoja')}</h3>
                <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 sm:imcrm-flex-row">
                    <Input
                        value={link}
                        placeholder="https://docs.google.com/spreadsheets/d/…"
                        onChange={(e) => setLink(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') open.mutate({ gid: null });
                        }}
                        data-testid="imcrm-sheet-link"
                        aria-label={__('Enlace de la planilla')}
                    />
                    <Button variant="outline" disabled={open.isPending || link.trim() === ''} onClick={() => open.mutate({ gid: null })} data-testid="imcrm-sheet-open">
                        {open.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <FileSpreadsheet className="imcrm-h-4 imcrm-w-4" />}
                        {__('Abrir')}
                    </Button>
                </div>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Copia la dirección de la planilla desde Google Sheets. La cuenta conectada tiene que poder abrirla (y editarla, si la app va a escribir en la hoja).')}
                </p>
                {preview && (
                    <>
                        <p className="imcrm-break-words imcrm-text-sm imcrm-font-medium" data-testid="imcrm-sheet-title">
                            {preview.spreadsheet_title}
                        </p>
                        <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label>{__('Pestaña')}</Label>
                                <Select
                                    value={preview.sheet_gid}
                                    onChange={(e) => open.mutate({ gid: Number(e.target.value) })}
                                    disabled={open.isPending}
                                    data-testid="imcrm-sheet-tab"
                                >
                                    {preview.tabs.map((t) => (
                                        <option key={t.gid} value={t.gid}>
                                            {t.title}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label>{__('Fila de los títulos')}</Label>
                                <Input
                                    type="number"
                                    min={1}
                                    max={50}
                                    value={headerRow}
                                    onChange={(e) => setHeaderRow(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
                                    onBlur={() => {
                                        if (headerRow !== preview.header_row) open.mutate({ gid: preview.sheet_gid, headerRow });
                                    }}
                                    data-testid="imcrm-sheet-header-row"
                                />
                            </div>
                        </div>
                        <SheetPreviewTable preview={preview} />
                    </>
                )}
                {sync && !preview && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {sync.spreadsheet_title} › {sync.sheet_title}. {__('Toca «Abrir» para ver sus columnas otra vez y cambiar el mapeo.')}
                    </p>
                )}
            </div>

            {/* 2. La lista y la clave */}
            <div className="imcrm-space-y-3">
                <h3 className="imcrm-text-sm imcrm-font-semibold">2. {__('La lista y cómo se emparejan')}</h3>
                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label>{__('Lista')}</Label>
                        <Select
                            value={listId}
                            onChange={(e) => {
                                setListId(Number(e.target.value));
                                setTargets({});
                                setExtra(new Set());
                            }}
                            data-testid="imcrm-sheet-list"
                        >
                            <option value={0}>{__('Elige una lista')}</option>
                            {(lists.data ?? []).map((l) => (
                                <option key={l.id} value={l.id}>
                                    {l.name}
                                </option>
                            ))}
                        </Select>
                    </div>
                    <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        <Label>{__('Nombre')}</Label>
                        <Input value={name} placeholder={__('Clientes ↔ planilla de ventas')} onChange={(e) => setName(e.target.value)} data-testid="imcrm-sheet-name" />
                    </div>
                </div>
                <div className="imcrm-space-y-2" role="radiogroup" aria-label={__('Cómo se emparejan las filas')} data-tour="sheet-sync-key">
                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="radio"
                            className="imcrm-mt-1"
                            checked={key.mode === 'app_id'}
                            onChange={() => changeKey({ mode: 'app_id', column: sheetColumns.find((c) => normalizeName(c) === normalizeName(SHEET_SYNC_ID_COLUMN)) ?? SHEET_SYNC_ID_COLUMN })}
                            data-testid="imcrm-sheet-key-app-id"
                        />
                        <span>
                            <span className="imcrm-font-medium">{__('Una columna «ID» que escribe la app')}</span>{' '}
                            <span className="imcrm-text-muted-foreground">({__('recomendado')})</span>
                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                {__('La app agrega la columna y escribe el número de cada registro. No la borres ni la edites: es lo que une cada fila con su registro.')}
                            </span>
                        </span>
                    </label>
                    {key.mode === 'app_id' && (
                        <div className="imcrm-ml-6 imcrm-flex imcrm-max-w-xs imcrm-flex-col imcrm-gap-1.5">
                            <Label htmlFor="sheet-id-col">{__('Nombre de la columna')}</Label>
                            <Input id="sheet-id-col" value={key.column} onChange={(e) => setKey({ mode: 'app_id', column: e.target.value })} data-testid="imcrm-sheet-id-column" />
                        </div>
                    )}
                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-sm">
                        <input
                            type="radio"
                            className="imcrm-mt-1"
                            checked={key.mode === 'field'}
                            onChange={() => {
                                const col = dataColumns[0] ?? '';
                                const f = usableKey.find((u) => u.is_unique) ?? usableKey[0];
                                changeKey({ mode: 'field', column: col, field_id: f?.id ?? CREATE_KEY_FIELD });
                            }}
                            data-testid="imcrm-sheet-key-field"
                        />
                        <span>
                            <span className="imcrm-font-medium">{__('Una columna de la hoja que no se repite')}</span>
                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                {__('Un email, un NIT o un código. Conviene que el campo de la lista esté marcado «Sin repetidos».')}
                            </span>
                        </span>
                    </label>
                    {key.mode === 'field' && (
                        <div className="imcrm-ml-6 imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label>{__('Columna en la hoja')}</Label>
                                <Select value={key.column} onChange={(e) => changeKey({ ...key, column: e.target.value })} data-testid="imcrm-sheet-key-column">
                                    <option value="">{__('Elige una columna')}</option>
                                    {sheetColumns.map((c) => (
                                        <option key={c} value={c}>
                                            {c}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label>{__('…es el campo')}</Label>
                                <Select
                                    value={keyCreate ? CREATE_KEY_FIELD : key.field_id}
                                    onChange={(e) => {
                                        const v = Number(e.target.value);
                                        if (v === CREATE_KEY_FIELD) setKeyCreate(true);
                                        else changeKey({ ...key, field_id: v });
                                    }}
                                    disabled={listId <= 0}
                                    data-testid="imcrm-sheet-key-target"
                                >
                                    <option value={CREATE_KEY_FIELD}>{key.column ? `${__('Crear campo')} «${key.column}»` : __('Crear campo nuevo')}</option>
                                    {usableKey.map((f) => (
                                        <option key={f.id} value={f.id}>
                                            {f.label}
                                            {f.is_unique ? ` · ${__('Sin repetidos')}` : ''}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 3. Columnas */}
            <div className="imcrm-space-y-3">
                <h3 className="imcrm-text-sm imcrm-font-semibold">3. {__('Qué columna va a qué campo')}</h3>
                {listId > 0 && !fieldsReady && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Cargando los campos de la lista…')}</p>}
                {fieldsReady && dataColumns.length > 0 && (
                    <div className="imcrm-overflow-x-auto imcrm-rounded-md imcrm-border imcrm-border-border">
                        <table className="imcrm-w-full imcrm-text-sm" data-testid="imcrm-sheet-mapping">
                            <thead className="imcrm-bg-muted/40 imcrm-text-xs imcrm-text-muted-foreground">
                                <tr>
                                    <th className="imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-font-medium">{__('Columna en la hoja')}</th>
                                    <th className="imcrm-px-3 imcrm-py-2 imcrm-text-left imcrm-font-medium">{__('Campo de la lista')}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {dataColumns.map((c) => {
                                    const t = targets[c] ?? { kind: 'skip' };
                                    const pc = preview?.columns.find((p) => p.name === c);
                                    const suggested = pc?.suggested_type ?? 'text';
                                    const value = t.kind === 'field' ? String(t.id) : t.kind === 'create' ? 'create' : 'skip';
                                    return (
                                        <tr key={c} className="imcrm-border-t imcrm-border-border">
                                            <td className="imcrm-px-3 imcrm-py-1.5 imcrm-text-xs">
                                                {pc && <span className="imcrm-mr-1.5 imcrm-text-muted-foreground">{pc.letter}</span>}
                                                <span className="imcrm-break-words">{c}</span>
                                            </td>
                                            <td className="imcrm-px-3 imcrm-py-1.5">
                                                <Select
                                                    value={value}
                                                    onChange={(e) => {
                                                        const v = e.target.value;
                                                        setTargets((prev) => ({
                                                            ...prev,
                                                            [c]:
                                                                v === 'skip'
                                                                    ? { kind: 'skip' }
                                                                    : v === 'create'
                                                                      ? { kind: 'create', type: t.kind === 'create' ? t.type : suggested }
                                                                      : { kind: 'field', id: Number(v) },
                                                        }));
                                                    }}
                                                    data-testid="imcrm-sheet-map"
                                                    data-column={c}
                                                >
                                                    <option value="skip">{__('No sincronizar')}</option>
                                                    <option value="create">{`${__('Crear campo')} «${c}» (${__(FIELD_TYPE_LABEL[t.kind === 'create' ? t.type : suggested] ?? 'Texto')})`}</option>
                                                    {usableValue
                                                        .filter((f) => key.mode !== 'field' || f.id !== key.field_id)
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
                {listId > 0 && writes && missing.length > 0 && (preview || sync) && (
                    <div className="imcrm-space-y-1.5 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-p-3" data-testid="imcrm-sheet-extra">
                        <p className="imcrm-text-xs imcrm-font-medium">{__('Campos de la lista que no están en la hoja')}</p>
                        <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Marca los que quieres llevar a la hoja: la app agrega su columna al final.')}</p>
                        <div className="imcrm-flex imcrm-flex-wrap imcrm-gap-x-4 imcrm-gap-y-1">
                            {missing.map((f) => (
                                <label key={f.id} className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm">
                                    <input
                                        type="checkbox"
                                        checked={extra.has(f.id)}
                                        onChange={(e) =>
                                            setExtra((prev) => {
                                                const next = new Set(prev);
                                                if (e.target.checked) next.add(f.id);
                                                else next.delete(f.id);
                                                return next;
                                            })
                                        }
                                        data-testid="imcrm-sheet-extra-field"
                                        data-field={f.id}
                                    />
                                    {f.label}
                                </label>
                            ))}
                        </div>
                    </div>
                )}
                {listId > 0 && !preview && !sync && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Abre la planilla para ver sus columnas y elegir a qué campo va cada una.')}</p>
                )}
                {listId <= 0 && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Elige la lista para elegir los campos.')}</p>}
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Sólo se sincronizan los campos que tú puedes ver. Los calculados, los archivos y las relaciones no viajan a la hoja.')}
                </p>
            </div>

            {/* 4. Sentido y borrados */}
            <div className="imcrm-space-y-3" data-tour="sheet-sync-direction">
                <h3 className="imcrm-text-sm imcrm-font-semibold">4. {__('En qué sentido')}</h3>
                <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-3" role="radiogroup" aria-label={__('Sentido')}>
                    {(['both', 'sheet_to_app', 'app_to_sheet'] as const).map((d) => (
                        <button
                            key={d}
                            type="button"
                            role="radio"
                            aria-checked={direction === d}
                            onClick={() => setDirection(d)}
                            className={cn(
                                'imcrm-rounded-md imcrm-border imcrm-p-3 imcrm-text-left imcrm-text-sm imcrm-transition-colors',
                                direction === d ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border hover:imcrm-bg-muted/40',
                            )}
                            data-testid="imcrm-sheet-direction"
                            data-direction={d}
                        >
                            <span className="imcrm-block imcrm-font-medium">{__(SHEET_DIRECTION_LABELS[d])}</span>
                            <span className="imcrm-mt-1 imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__(DIRECTION_HELP[d])}</span>
                        </button>
                    ))}
                </div>
                <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                    {reads && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label>{__('Si se borra una fila de la hoja')}</Label>
                            <Select value={onSheetDelete} onChange={(e) => setOnSheetDelete(e.target.value as 'ignore' | 'trash')} data-testid="imcrm-sheet-on-sheet-delete">
                                <option value="ignore">{__('No tocar el registro')}</option>
                                <option value="trash">{__('Mandar el registro a la papelera')}</option>
                            </Select>
                        </div>
                    )}
                    {writes && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <Label>{__('Si se borra un registro de la lista')}</Label>
                            <Select value={onAppDelete} onChange={(e) => setOnAppDelete(e.target.value as 'ignore' | 'delete_row')} data-testid="imcrm-sheet-on-app-delete">
                                <option value="ignore">{__('Dejar la fila')}</option>
                                <option value="delete_row">{__('Borrar la fila de la hoja')}</option>
                            </Select>
                        </div>
                    )}
                </div>
            </div>

            {/* 5. Cuándo */}
            <div className="imcrm-space-y-3">
                <h3 className="imcrm-text-sm imcrm-font-semibold">5. {__('Cada cuánto')}</h3>
                <Select className="sm:imcrm-max-w-xs" value={interval} onChange={(e) => setIntervalMinutes(Number(e.target.value))} data-testid="imcrm-sheet-interval">
                    {SHEET_SYNC_INTERVALS.map((m) => (
                        <option key={m} value={m}>
                            {__(describeSheetInterval(m).replace(/^./, (c) => c.toUpperCase()))}
                        </option>
                    ))}
                </Select>
                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                    {writes
                        ? __('Lo que cambias en la lista llega a la hoja a los pocos segundos; lo que cambia en la hoja se trae con esta frecuencia (o con «Sincronizar ahora»).')
                        : __('Lo que cambia en la hoja se trae con esta frecuencia (o con «Sincronizar ahora»).')}
                </p>
                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} data-testid="imcrm-sheet-enabled" />
                    {sync ? __('Activa') : __('Activarla y sincronizar ahora')}
                </label>
                {!sync && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('La primera carga no dispara automatizaciones (para no mandar cientos de correos de golpe); las siguientes sí, con el valor anterior y el nuevo.')}
                    </p>
                )}
            </div>

            {error && (
                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-sm imcrm-text-destructive" data-testid="imcrm-sheet-editor-error">
                    <AlertTriangle className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0" />
                    <span className="imcrm-min-w-0 imcrm-break-words">{error}</span>
                </p>
            )}
            <div className="imcrm-flex imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-4">
                <Button variant="ghost" onClick={onClose}>
                    {__('Cancelar')}
                </Button>
                <Button disabled={save.isPending || (listId > 0 && !fieldsReady)} onClick={() => save.mutate()} data-testid="imcrm-sheet-save">
                    {save.isPending ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <CheckCircle2 className="imcrm-h-4 imcrm-w-4" />}
                    {__('Guardar')}
                </Button>
            </div>
        </section>
    );
}

function SheetPreviewTable({ preview }: { preview: SheetPreviewResult }): JSX.Element {
    if (preview.empty) {
        return (
            <p className="imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-p-3 imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-sheet-preview">
                {__('La pestaña está vacía: la app escribe los títulos de las columnas al sincronizar (elige «De la app a la hoja» o «En los dos sentidos»).')}
            </p>
        );
    }
    return (
        <div className="imcrm-space-y-1.5" data-testid="imcrm-sheet-preview">
            <p className="imcrm-text-xs imcrm-text-muted-foreground">
                {preview.columns.length} {__('columnas')} · {formatNumber(preview.total_rows)} {__('filas con datos')}
            </p>
            <div className="imcrm-max-h-64 imcrm-overflow-auto imcrm-rounded-md imcrm-border imcrm-border-border">
                <table className="imcrm-w-full imcrm-text-xs">
                    <thead className="imcrm-sticky imcrm-top-0 imcrm-bg-muted">
                        <tr>
                            {preview.columns.map((c) => (
                                <th key={c.name} className="imcrm-whitespace-nowrap imcrm-px-2 imcrm-py-1.5 imcrm-text-left imcrm-font-medium">
                                    <span className="imcrm-mr-1 imcrm-font-normal imcrm-text-muted-foreground">{c.letter}</span>
                                    {c.name}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {preview.rows.map((r, i) => (
                            <tr key={i} className="imcrm-border-t imcrm-border-border">
                                {preview.columns.map((c) => (
                                    <td key={c.name} className="imcrm-max-w-[16rem] imcrm-truncate imcrm-whitespace-nowrap imcrm-px-2 imcrm-py-1">
                                        {r[c.name] ?? <span className="imcrm-text-muted-foreground">—</span>}
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
