import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, FileSpreadsheet, FileUp, KeyRound, Loader2, Undo2, X } from 'lucide-react';
import {
    IMPORT_ID_COLUMN,
    IMPORT_MATCH_BY_ID,
    IMPORT_MATCH_TYPES,
    IMPORT_PARENT_COLUMN,
    IMPORT_UPDATE_CHUNK,
    type ImportCsvPreviewResult,
    type ImportUpdatePreview,
    type ImportUpdateResult,
} from '@imagina-base/shared';

import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { BulkApplyProgress } from '@/hooks/useBulkEdit';
import { bulkHistoryKeys } from '@/hooks/useBulkHistory';
import { invalidateForList, recordsKeys } from '@/hooks/useRecords';
import { api, ApiError } from '@/lib/api';
import { __, _n, sprintf } from '@/lib/i18n';
import { formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { BulkRevertDialog } from './BulkRevertDialog';

interface CsvUpdateDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    listId: number;
    /** Lista de una tienda: sólo actualizar (crear se hace en WooCommerce). */
    storeManaged: boolean;
    /** Columnas que no se pueden escribir (las de la tienda que no viajan). */
    isLocked?: (fieldId: number) => boolean;
}

type Phase = 'upload' | 'setup' | 'preview' | 'applying' | 'done';

/**
 * Actualizar registros desde un archivo (v0.1.219): «la lista de precios del
 * proveedor», «el stock que mandó el depósito». El archivo se empareja con los
 * registros que ya existen por una columna clave (el ID de la app o un campo
 * como el SKU o el email) y cambia sólo las columnas elegidas. Vista previa con
 * el antes → después, aplicación por tramos con avance y, al final, se puede
 * deshacer como cualquier edición masiva.
 */
export function CsvUpdateDialog({ open, onOpenChange, listId, storeManaged, isLocked }: CsvUpdateDialogProps): JSX.Element {
    const qc = useQueryClient();
    const [phase, setPhase] = useState<Phase>('upload');
    const [csv, setCsv] = useState('');
    const [fileName, setFileName] = useState('');
    const [info, setInfo] = useState<ImportCsvPreviewResult | null>(null);
    const [mapping, setMapping] = useState<Record<number, string>>({});
    const [matchCol, setMatchCol] = useState(0);
    const [matchBy, setMatchBy] = useState<string>(IMPORT_MATCH_BY_ID);
    const [upsert, setUpsert] = useState(false);
    const [clearEmpty, setClearEmpty] = useState(false);
    const [preview, setPreview] = useState<ImportUpdatePreview | null>(null);
    const [progress, setProgress] = useState<BulkApplyProgress | null>(null);
    const [result, setResult] = useState<ImportUpdateResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [undoOpen, setUndoOpen] = useState(false);

    useEffect(() => {
        if (!open) return;
        setPhase('upload');
        setCsv('');
        setFileName('');
        setInfo(null);
        setMapping({});
        setPreview(null);
        setProgress(null);
        setResult(null);
        setError(null);
        setUpsert(false);
        setClearEmpty(false);
        setUndoOpen(false);
    }, [open]);

    const writable = useMemo(
        () => (info?.fields ?? []).filter((f) => !(isLocked?.(f.id) ?? false)),
        [info, isLocked],
    );
    const keyFields = useMemo(
        () => (info?.fields ?? []).filter((f) => (IMPORT_MATCH_TYPES as readonly string[]).includes(f.type)),
        [info],
    );

    const onFile = (file: File): void => {
        setError(null);
        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = async () => {
            const text = typeof reader.result === 'string' ? reader.result : '';
            if (text === '') {
                setError(__('El archivo está vacío o no se pudo leer.'));
                return;
            }
            setCsv(text);
            setBusy(true);
            try {
                const res = await api.post<ImportCsvPreviewResult>(`/lists/${listId}/import/preview`, { csv: text, mode: 'update' });
                const p = res.data;
                setInfo(p);
                // La columna clave: «ID» si el archivo salió del export; si no,
                // la primera sugerida contra un campo que sirve de clave (SKU, email…).
                const suggested = p.suggested_mapping ?? {};
                const idIdx = Object.entries(suggested).find(([, v]) => v === IMPORT_ID_COLUMN)?.[0];
                const keyTypes = new Set<string>(IMPORT_MATCH_TYPES);
                const keyIdx = Object.entries(suggested).find(([, slug]) => {
                    const fld = p.fields.find((f) => f.slug === slug);
                    return fld && keyTypes.has(fld.type) && /sku|c[oó]digo|code|ref|email|correo|documento|nit|id/i.test(fld.label + fld.slug);
                });
                if (idIdx !== undefined) {
                    setMatchCol(Number(idIdx));
                    setMatchBy(IMPORT_MATCH_BY_ID);
                } else if (keyIdx) {
                    setMatchCol(Number(keyIdx[0]));
                    setMatchBy(keyIdx[1]);
                } else {
                    setMatchCol(0);
                    setMatchBy(IMPORT_MATCH_BY_ID);
                }
                const lockedSlugs = new Set(p.fields.filter((f) => isLocked?.(f.id)).map((f) => f.slug));
                const m: Record<number, string> = {};
                for (const [k, slug] of Object.entries(suggested)) {
                    if (slug === IMPORT_ID_COLUMN || slug === IMPORT_PARENT_COLUMN || lockedSlugs.has(slug)) continue;
                    m[Number(k)] = slug;
                }
                setMapping(m);
                setPhase('setup');
            } catch (err) {
                setError(err instanceof ApiError || err instanceof Error ? err.message : __('No se pudo leer el archivo.'));
            } finally {
                setBusy(false);
            }
        };
        reader.readAsText(file, 'UTF-8');
    };

    const body = (extra: Record<string, unknown> = {}) => {
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(mapping)) if (v && Number(k) !== matchCol) clean[k] = v;
        return {
            csv,
            mapping: clean,
            match: { column_index: matchCol, by: matchBy },
            mode: upsert ? 'upsert' : 'update',
            clear_empty: clearEmpty,
            ...extra,
        };
    };

    const runPreview = async (): Promise<void> => {
        setError(null);
        setBusy(true);
        try {
            const res = await api.post<ImportUpdatePreview>(`/lists/${listId}/import/update/preview`, body());
            setPreview(res.data);
            setPhase('preview');
        } catch (err) {
            setError(err instanceof ApiError || err instanceof Error ? err.message : __('Error desconocido'));
        } finally {
            setBusy(false);
        }
    };

    const runApply = async (): Promise<void> => {
        if (!preview) return;
        setPhase('applying');
        const total = preview.total_rows;
        const out: ImportUpdateResult = { updated: 0, created: 0, unchanged: 0, unmatched: 0, failed: [], edit_id: null };
        setProgress({ done: 0, total });
        for (let offset = 0; offset < total; offset += IMPORT_UPDATE_CHUNK) {
            try {
                const res = (
                    await api.post<ImportUpdateResult>(
                        `/lists/${listId}/import/update`,
                        body({ row_offset: offset, row_limit: IMPORT_UPDATE_CHUNK, ...(out.edit_id ? { edit_id: out.edit_id } : {}) }),
                    )
                ).data;
                out.edit_id = res.edit_id ?? out.edit_id;
                out.updated += res.updated;
                out.created += res.created;
                out.unchanged += res.unchanged;
                out.unmatched += res.unmatched;
                out.failed.push(...res.failed);
            } catch (err) {
                out.failed.push({ row: offset + 2, message: err instanceof Error ? err.message : 'Error' });
            }
            setProgress({ done: Math.min(total, offset + IMPORT_UPDATE_CHUNK), total });
        }
        setResult(out);
        setPhase('done');
        invalidateForList(qc, recordsKeys.all, listId);
        void qc.invalidateQueries({ queryKey: bulkHistoryKeys.forList(listId) });
    };

    const matchLabel =
        matchBy === IMPORT_MATCH_BY_ID ? __('el ID del registro') : (keyFields.find((f) => f.slug === matchBy)?.label ?? matchBy);

    return (
        <Dialog.Root open={open} onOpenChange={(o) => (phase === 'applying' ? undefined : onOpenChange(o))}>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-flex imcrm-max-h-[90vh] imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-3xl',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2 imcrm-flex-col imcrm-rounded-xl imcrm-border imcrm-border-border imcrm-bg-background imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-csv-update-dialog"
                    onEscapeKeyDown={(e) => phase === 'applying' && e.preventDefault()}
                    onPointerDownOutside={(e) => e.preventDefault()}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-3 imcrm-border-b imcrm-border-border imcrm-px-5 imcrm-py-4">
                        <div className="imcrm-min-w-0">
                            <Dialog.Title className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base imcrm-font-semibold">
                                <FileSpreadsheet className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" aria-hidden />
                                {__('Actualizar desde un archivo')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-mt-0.5 imcrm-text-xs imcrm-text-muted-foreground">
                                {fileName !== ''
                                    ? fileName
                                    : __('Cada fila del archivo se empareja con un registro que ya existe y le cambia sólo las columnas que elijas.')}
                            </Dialog.Description>
                        </div>
                        {phase !== 'applying' && (
                            <Dialog.Close asChild>
                                <button type="button" aria-label={__('Cerrar')} className="imcrm-rounded imcrm-p-1 imcrm-text-muted-foreground hover:imcrm-bg-accent">
                                    <X className="imcrm-h-4 imcrm-w-4" />
                                </button>
                            </Dialog.Close>
                        )}
                    </div>

                    <div className="imcrm-min-h-0 imcrm-flex-1 imcrm-overflow-y-auto imcrm-px-5 imcrm-py-4">
                        {error && (
                            <p className="imcrm-mb-3 imcrm-rounded-md imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-sm imcrm-text-destructive" role="alert">
                                {error}
                            </p>
                        )}

                        {phase === 'upload' && (
                            <label
                                className={cn(
                                    'imcrm-flex imcrm-cursor-pointer imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/20 imcrm-p-10 imcrm-text-center hover:imcrm-bg-muted/40',
                                    busy && 'imcrm-pointer-events-none imcrm-opacity-60',
                                )}
                            >
                                <FileUp className="imcrm-h-8 imcrm-w-8 imcrm-text-muted-foreground" />
                                <span className="imcrm-text-sm imcrm-font-medium">{__('Elige un archivo CSV')}</span>
                                <span className="imcrm-max-w-md imcrm-text-xs imcrm-text-muted-foreground">
                                    {__('Tiene que tener una columna que identifique cada registro: el ID (la que trae la exportación de esta lista) o un campo único como el SKU o el email. Hasta 5.000 filas.')}
                                </span>
                                {busy && <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />}
                                <input
                                    type="file"
                                    accept=".csv,text/csv,text/plain"
                                    className="imcrm-sr-only"
                                    disabled={busy}
                                    onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) onFile(f);
                                    }}
                                    data-testid="imcrm-csv-update-file"
                                />
                            </label>
                        )}

                        {phase === 'setup' && info && (
                            <div className="imcrm-space-y-4">
                                <div className="imcrm-rounded-lg imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-p-3">
                                    <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium">
                                        <KeyRound className="imcrm-h-4 imcrm-w-4 imcrm-text-primary" />
                                        {__('¿Cómo se reconoce cada registro?')}
                                    </p>
                                    <div className="imcrm-mt-2 imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2">
                                        <label className="imcrm-text-xs">
                                            <span className="imcrm-mb-1 imcrm-block imcrm-text-muted-foreground">{__('Columna del archivo')}</span>
                                            <Select value={String(matchCol)} onChange={(e) => setMatchCol(Number(e.target.value))} data-testid="imcrm-csv-update-match-col">
                                                {info.headers.map((h, i) => (
                                                    <option key={i} value={i}>
                                                        {h || `${__('Columna')} ${i + 1}`}
                                                    </option>
                                                ))}
                                            </Select>
                                        </label>
                                        <label className="imcrm-text-xs">
                                            <span className="imcrm-mb-1 imcrm-block imcrm-text-muted-foreground">{__('Coincide con')}</span>
                                            <Select value={matchBy} onChange={(e) => setMatchBy(e.target.value)} data-testid="imcrm-csv-update-match-by">
                                                <option value={IMPORT_MATCH_BY_ID}>{__('El ID del registro')}</option>
                                                {keyFields.map((f) => (
                                                    <option key={f.slug} value={f.slug}>
                                                        {f.label}
                                                    </option>
                                                ))}
                                            </Select>
                                        </label>
                                    </div>
                                    <p className="imcrm-mt-1.5 imcrm-text-[11px] imcrm-text-muted-foreground">
                                        {__('Sin importar mayúsculas ni espacios; en teléfonos, sólo los números.')}
                                    </p>
                                </div>

                                <div>
                                    <p className="imcrm-mb-1.5 imcrm-text-sm imcrm-font-medium">{__('Qué columnas actualizar')}</p>
                                    <div className="imcrm-overflow-x-auto imcrm-rounded-md imcrm-border imcrm-border-border">
                                        <table className="imcrm-w-full imcrm-text-xs">
                                            <thead className="imcrm-bg-muted/30 imcrm-text-left imcrm-text-muted-foreground">
                                                <tr>
                                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Columna del archivo')}</th>
                                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Actualiza')}</th>
                                                    <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Ejemplos')}</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {info.headers.map((h, i) => (
                                                    <tr key={i} className="imcrm-border-t imcrm-border-border">
                                                        <td className="imcrm-px-2 imcrm-py-1.5 imcrm-font-medium">{h || `${__('Columna')} ${i + 1}`}</td>
                                                        <td className="imcrm-px-2 imcrm-py-1.5">
                                                            {i === matchCol ? (
                                                                <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-primary">
                                                                    <KeyRound className="imcrm-h-3 imcrm-w-3" />
                                                                    {__('Clave')}
                                                                </span>
                                                            ) : (
                                                                <Select
                                                                    className="imcrm-h-8"
                                                                    value={mapping[i] ?? ''}
                                                                    onChange={(e) => {
                                                                        const next = { ...mapping };
                                                                        if (e.target.value === '') delete next[i];
                                                                        else next[i] = e.target.value;
                                                                        setMapping(next);
                                                                    }}
                                                                    data-testid={`imcrm-csv-update-map-${i}`}
                                                                >
                                                                    <option value="">{__('— No tocar —')}</option>
                                                                    {writable.map((f) => (
                                                                        <option key={f.slug} value={f.slug}>
                                                                            {f.label}
                                                                        </option>
                                                                    ))}
                                                                </Select>
                                                            )}
                                                        </td>
                                                        <td className="imcrm-max-w-[14rem] imcrm-truncate imcrm-px-2 imcrm-py-1.5 imcrm-text-muted-foreground">
                                                            {info.sample
                                                                .slice(0, 3)
                                                                .map((r) => r[i] ?? '')
                                                                .filter((v) => v !== '')
                                                                .join(' · ') || '—'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>

                                <div className="imcrm-space-y-2 imcrm-text-sm">
                                    <label className="imcrm-flex imcrm-items-start imcrm-gap-2">
                                        <input type="checkbox" className="imcrm-mt-0.5" checked={clearEmpty} onChange={(e) => setClearEmpty(e.target.checked)} />
                                        <span>
                                            {__('Una celda vacía vacía el campo')}
                                            <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                                {__('Si no lo marcas, las celdas vacías dejan el valor como está.')}
                                            </span>
                                        </span>
                                    </label>
                                    {!storeManaged && (
                                        <label className="imcrm-flex imcrm-items-start imcrm-gap-2">
                                            <input type="checkbox" className="imcrm-mt-0.5" checked={upsert} onChange={(e) => setUpsert(e.target.checked)} data-testid="imcrm-csv-update-upsert" />
                                            <span>
                                                {__('Crear los que no existen')}
                                                <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                                                    {__('Las filas que no encuentran su registro se agregan como registros nuevos.')}
                                                </span>
                                            </span>
                                        </label>
                                    )}
                                    {storeManaged && (
                                        <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                            {__('Lista de la tienda: sólo se actualizan las columnas que viajan a WooCommerce; los productos nuevos se crean en la tienda.')}
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}

                        {phase === 'preview' && preview && (
                            <div className="imcrm-space-y-4" data-testid="imcrm-csv-update-preview">
                                <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-2 sm:imcrm-grid-cols-4">
                                    <Stat label={__('Cambian')} value={preview.changed} tone="ok" testId="imcrm-csv-update-stat-changed" />
                                    <Stat label={__('Ya estaban así')} value={preview.unchanged} tone="muted" />
                                    <Stat
                                        label={upsert ? __('Se crean') : __('Sin registro')}
                                        value={upsert ? preview.to_create : preview.unmatched}
                                        tone={upsert ? 'ok' : preview.unmatched > 0 ? 'warn' : 'muted'}
                                        testId="imcrm-csv-update-stat-unmatched"
                                    />
                                    <Stat label={__('Con error')} value={preview.error_count} tone={preview.error_count > 0 ? 'warn' : 'muted'} testId="imcrm-csv-update-stat-errors" />
                                </div>
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                    {sprintf(__('Emparejado por %s.'), matchLabel)}
                                    {preview.truncated && ` ${__('El archivo pasa de 5.000 filas: se procesan las primeras 5.000.')}`}
                                </p>
                                {!upsert && preview.unmatched_sample.length > 0 && (
                                    <div className="imcrm-rounded-md imcrm-border imcrm-border-amber-500/40 imcrm-bg-amber-500/5 imcrm-p-3 imcrm-text-xs">
                                        <p className="imcrm-font-medium">{__('Estas filas no encontraron su registro (no se tocan):')}</p>
                                        <p className="imcrm-mt-1 imcrm-text-muted-foreground" data-testid="imcrm-csv-update-unmatched">
                                            {preview.unmatched_sample.map((u) => `${__('fila')} ${u.row}: ${u.key}`).join(' · ')}
                                        </p>
                                    </div>
                                )}
                                {preview.errors.length > 0 && (
                                    <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-3">
                                        <p className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-text-sm imcrm-font-medium imcrm-text-destructive">
                                            <AlertTriangle className="imcrm-h-4 imcrm-w-4" />
                                            {__('Filas que no se van a aplicar')}
                                        </p>
                                        <ul className="imcrm-mt-1.5 imcrm-max-h-32 imcrm-space-y-0.5 imcrm-overflow-y-auto imcrm-text-xs" data-testid="imcrm-csv-update-errors">
                                            {preview.errors.map((e) => (
                                                <li key={e.row}>
                                                    <span className="imcrm-font-medium">
                                                        {__('Fila')} {e.row}
                                                    </span>{' '}
                                                    — {e.message}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                                {preview.sample.length > 0 && (
                                    <div>
                                        <p className="imcrm-mb-1.5 imcrm-text-xs imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                                            {__('Así quedan')}
                                        </p>
                                        <ul className="imcrm-divide-y imcrm-divide-border imcrm-rounded-md imcrm-border imcrm-border-border">
                                            {preview.sample.map((s) => (
                                                <li key={s.row} className="imcrm-px-3 imcrm-py-2">
                                                    <p className="imcrm-truncate imcrm-text-sm imcrm-font-medium">{s.title}</p>
                                                    <ul className="imcrm-mt-0.5 imcrm-space-y-0.5">
                                                        {s.changes.map((c) => (
                                                            <li key={c.label} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1.5 imcrm-text-xs">
                                                                <span className="imcrm-text-muted-foreground">{c.label}:</span>
                                                                <span className="imcrm-line-through imcrm-opacity-70">{pretty(c.before)}</span>
                                                                <ArrowRight className="imcrm-h-3 imcrm-w-3 imcrm-text-muted-foreground" />
                                                                <span className="imcrm-font-medium" data-testid="imcrm-csv-update-after">
                                                                    {pretty(c.after)}
                                                                </span>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}

                        {phase === 'applying' && (
                            <div className="imcrm-py-8 imcrm-text-center" aria-live="polite">
                                <Loader2 className="imcrm-mx-auto imcrm-h-6 imcrm-w-6 imcrm-animate-spin imcrm-text-primary" />
                                <p className="imcrm-mt-3 imcrm-text-sm">
                                    {progress
                                        ? sprintf(__('Actualizando… fila %1$s de %2$s'), formatNumber(progress.done), formatNumber(progress.total))
                                        : __('Actualizando…')}
                                </p>
                                <div className="imcrm-mx-auto imcrm-mt-3 imcrm-h-2 imcrm-max-w-sm imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted">
                                    <div
                                        className="imcrm-h-full imcrm-rounded-full imcrm-bg-primary imcrm-transition-all"
                                        style={{ width: `${progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                                        data-testid="imcrm-csv-update-progress"
                                    />
                                </div>
                            </div>
                        )}

                        {phase === 'done' && result && (
                            <div className="imcrm-space-y-3" data-testid="imcrm-csv-update-result">
                                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-font-medium">
                                    <CheckCircle2 className="imcrm-h-4 imcrm-w-4 imcrm-text-emerald-600" />
                                    {sprintf(_n('Se actualizó %s registro.', 'Se actualizaron %s registros.', result.updated), formatNumber(result.updated))}
                                    {result.created > 0 && ` ${sprintf(_n('Se creó %s.', 'Se crearon %s.', result.created), formatNumber(result.created))}`}
                                </p>
                                {(result.unchanged > 0 || result.unmatched > 0) && (
                                    <p className="imcrm-text-sm imcrm-text-muted-foreground">
                                        {[
                                            result.unchanged > 0 ? sprintf(_n('%d ya estaba así', '%d ya estaban así', result.unchanged), result.unchanged) : null,
                                            result.unmatched > 0 ? sprintf(_n('%d fila sin registro', '%d filas sin registro', result.unmatched), result.unmatched) : null,
                                        ]
                                            .filter(Boolean)
                                            .join(' · ')}
                                    </p>
                                )}
                                {result.failed.length > 0 && (
                                    <div className="imcrm-rounded-md imcrm-border imcrm-border-destructive/30 imcrm-bg-destructive/5 imcrm-p-3">
                                        <p className="imcrm-text-sm imcrm-font-medium imcrm-text-destructive">
                                            {sprintf(_n('%d fila no se aplicó:', '%d filas no se aplicaron:', result.failed.length), result.failed.length)}
                                        </p>
                                        <ul className="imcrm-mt-1.5 imcrm-max-h-40 imcrm-space-y-0.5 imcrm-overflow-y-auto imcrm-text-xs">
                                            {result.failed.slice(0, 100).map((f, i) => (
                                                <li key={`${f.row}-${i}`}>
                                                    <span className="imcrm-font-medium">
                                                        {__('Fila')} {f.row}
                                                    </span>{' '}
                                                    — {f.message}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-px-5 imcrm-py-3">
                        {phase === 'setup' && (
                            <>
                                <Button variant="ghost" onClick={() => setPhase('upload')}>
                                    {__('Otro archivo')}
                                </Button>
                                <Button
                                    onClick={() => void runPreview()}
                                    disabled={busy || (Object.keys(mapping).filter((k) => Number(k) !== matchCol).length === 0 && !upsert)}
                                    data-testid="imcrm-csv-update-preview-btn"
                                >
                                    {busy && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                                    {__('Ver vista previa')}
                                </Button>
                            </>
                        )}
                        {phase === 'preview' && preview && (
                            <>
                                <Button variant="ghost" onClick={() => setPhase('setup')}>
                                    {__('Volver')}
                                </Button>
                                <Button
                                    onClick={() => void runApply()}
                                    disabled={preview.changed + (upsert ? preview.to_create : 0) === 0}
                                    data-testid="imcrm-csv-update-apply-btn"
                                >
                                    {preview.changed + (upsert ? preview.to_create : 0) === 0
                                        ? __('No hay nada que cambiar')
                                        : sprintf(
                                              _n('Aplicar a %s registro', 'Aplicar a %s registros', preview.changed + (upsert ? preview.to_create : 0)),
                                              formatNumber(preview.changed + (upsert ? preview.to_create : 0)),
                                          )}
                                </Button>
                            </>
                        )}
                        {phase === 'done' && result?.edit_id && result.updated > 0 && (
                            <Button variant="outline" onClick={() => setUndoOpen(true)} data-testid="imcrm-csv-update-undo-btn">
                                <Undo2 className="imcrm-h-4 imcrm-w-4" />
                                {__('Deshacer')}
                            </Button>
                        )}
                        {phase === 'done' && (
                            <Button onClick={() => onOpenChange(false)} data-testid="imcrm-csv-update-close-btn">
                                {__('Listo')}
                            </Button>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
            {undoOpen && result?.edit_id && (
                <BulkRevertDialog
                    open
                    onOpenChange={(o) => {
                        if (!o) {
                            setUndoOpen(false);
                            onOpenChange(false);
                        }
                    }}
                    listId={listId}
                    editId={result.edit_id}
                    summary={sprintf(__('La actualización desde «%s»'), fileName)}
                />
            )}
        </Dialog.Root>
    );
}

function pretty(s: string): string {
    return /^-?\d+(\.\d+)?$/.test(s) ? formatNumber(Number(s)) : s;
}

function Stat({ label, value, tone, testId }: { label: string; value: number; tone: 'ok' | 'warn' | 'muted'; testId?: string }): JSX.Element {
    return (
        <div className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-px-3 imcrm-py-2">
            <p
                className={cn(
                    'imcrm-text-lg imcrm-font-semibold',
                    tone === 'ok' && 'imcrm-text-emerald-600',
                    tone === 'warn' && 'imcrm-text-amber-600',
                    tone === 'muted' && 'imcrm-text-muted-foreground',
                )}
                data-testid={testId}
            >
                {formatNumber(value)}
            </p>
            <p className="imcrm-text-xs imcrm-text-muted-foreground">{label}</p>
        </div>
    );
}
