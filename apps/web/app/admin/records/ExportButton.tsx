import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Download, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useFields } from '@/hooks/useFields';
import { getBootData } from '@/lib/boot';
import { isCloud } from '@/lib/cloudFeatures';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FilterTree } from '@/types/record';

interface ExportButtonProps {
    listId: number | undefined;
    listSlug: string;
    /** Filtros activos — se aplican al export (mismo subset que la vista). */
    filterTree?: FilterTree;
    /** Si pasas IDs, son los pre-seleccionados en el dialog. */
    fieldIds?: number[];
    /** Total de records de la lista actual. Si > ASYNC_THRESHOLD,
     * el export pasa por Action Scheduler en lugar de stream
     * síncrono (Fase 17.A). */
    totalRecords?: number;
    disabled?: boolean;
}

/**
 * Umbral en filas por encima del cual el export se procesa async
 * via Action Scheduler. Sincronizado con
 * `ExportJobService::ASYNC_THRESHOLD_ROWS` del backend.
 */
const ASYNC_THRESHOLD = 5000;

/**
 * Botón "Exportar" en la toolbar de Records (Fase 15.B).
 *
 * Antes: click → download directo del CSV con los fields visibles
 * de la vista. Ahora: click → dialog con opciones:
 *
 *  - Selección granular de fields a incluir (checkboxes).
 *  - Delimiter: coma (default) o punto y coma (locales que usan
 *    coma como decimal — Excel español/europeo).
 *  - UTF-8 BOM: opt-in para que Excel respete los acentos al abrir.
 *
 * El download sigue siendo via fetch + Blob para preservar
 * Content-Disposition (filename con timestamp) y manejar errores
 * con toast en lugar de pestaña en blanco.
 */
export function ExportButton({
    listId,
    listSlug,
    filterTree,
    fieldIds: initialFieldIds,
    totalRecords,
    disabled,
}: ExportButtonProps): JSX.Element {
    const [open, setOpen] = useState(false);
    const [busy, setBusy] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set(initialFieldIds ?? []));
    const [delimiter, setDelimiter] = useState<',' | ';'>(',');
    const [withBom, setWithBom] = useState(true);

    const fields = useFields(listId);

    // Cuando abre el dialog, si no había selección previa
    // pre-seleccionamos todos los fields no-relation.
    useEffect(() => {
        if (! open || ! fields.data) return;
        if (selectedIds.size === 0) {
            const defaults = fields.data
                .filter((f) => f.type !== 'relation')
                .map((f) => f.id);
            setSelectedIds(new Set(defaults));
        }
    }, [open, fields.data, selectedIds.size]);

    const exportableFields = useMemo(
        () => (fields.data ?? []).filter((f) => f.type !== 'relation'),
        [fields.data],
    );

    const toggleField = (id: number): void => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAll = (): void => {
        setSelectedIds(new Set(exportableFields.map((f) => f.id)));
    };

    const selectNone = (): void => {
        setSelectedIds(new Set());
    };

    const run = async (): Promise<void> => {
        setBusy(true);
        try {
            const boot = getBootData();
            const params = new URLSearchParams();
            if (filterTree && filterTree.children.length > 0) {
                params.set('filter_tree', JSON.stringify(filterTree));
            }
            // Mantenemos el orden original de fields del schema, no del
            // orden de toggle. Esto evita columnas barajadas en el CSV
            // si el user clickea en distinto orden.
            const orderedIds = exportableFields
                .filter((f) => selectedIds.has(f.id))
                .map((f) => f.id);
            if (orderedIds.length > 0) {
                params.set('fields', orderedIds.join(','));
            }
            if (delimiter === ';') {
                params.set('delimiter', ';');
            }
            if (withBom) {
                params.set('with_bom', '1');
            }

            const cloud = isCloud();
            if (cloud) {
                // El backend cloud sirve CSV cuando format=csv.
                params.set('format', 'csv');
            }

            // Async opt-in cuando la lista pasa el umbral (Fase 17.A).
            // El backend en modo async devuelve 202 con `job_id`; el
            // frontend lo polea hasta que esté ready. Solo WP: en la
            // nube no existe /export/jobs/:id — siempre stream síncrono.
            const useAsync = !cloud && (totalRecords ?? 0) > ASYNC_THRESHOLD;
            if (useAsync) {
                params.set('async', '1');
            }

            const base = boot.restRoot.replace(/\/$/, '');
            const url = `${base}/lists/${listSlug}/export${params.toString() ? `?${params}` : ''}`;

            // Auth: en la nube, cookie de sesión + tenant activo; en WP, nonce.
            const headers: Record<string, string> = {};
            if (cloud) {
                if (boot.tenantId !== null) headers['X-Tenant-Id'] = String(boot.tenantId);
            } else {
                headers['X-WP-Nonce'] = boot.restNonce;
            }

            const res = await fetch(url, {
                method: 'GET',
                headers,
                credentials: cloud ? 'include' : 'same-origin',
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            if (useAsync && res.status === 202) {
                const body = (await res.json()) as {
                    data: { job_id: number; poll_url: string };
                };
                const jobId = body.data.job_id;
                await pollAndDownload(boot, jobId);
                setOpen(false);
                return;
            }

            const blob = await res.blob();
            const cd = res.headers.get('Content-Disposition') ?? '';
            const match = cd.match(/filename="?([^";]+)"?/i);
            const filename = match?.[1] ?? `${listSlug}.csv`;

            const objectUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(objectUrl);

            setOpen(false);
        } catch {
            // eslint-disable-next-line no-alert
            alert(__('No se pudo exportar. Vuelve a intentarlo.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            <Dialog.Trigger asChild>
                <Button variant="outline" disabled={disabled} className="imcrm-gap-2">
                    <Download className="imcrm-h-4 imcrm-w-4" />
                    {__('Exportar')}
                </Button>
            </Dialog.Trigger>
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg',
                    )}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {__('Exportar registros')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {filterTree && filterTree.children.length > 0
                                    ? __('Se exportan los registros filtrados actualmente.')
                                    : __('Se exportan todos los registros visibles de la lista.')}
                            </Dialog.Description>
                        </div>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <div className="imcrm-mt-4 imcrm-flex imcrm-flex-col imcrm-gap-4">
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                                <Label className="imcrm-text-xs imcrm-font-medium">
                                    {__('Campos a exportar')}
                                </Label>
                                <div className="imcrm-flex imcrm-gap-2 imcrm-text-[11px]">
                                    <button
                                        type="button"
                                        onClick={selectAll}
                                        className="imcrm-text-primary hover:imcrm-underline"
                                    >
                                        {__('Todos')}
                                    </button>
                                    <span className="imcrm-text-muted-foreground">·</span>
                                    <button
                                        type="button"
                                        onClick={selectNone}
                                        className="imcrm-text-primary hover:imcrm-underline"
                                    >
                                        {__('Ninguno')}
                                    </button>
                                </div>
                            </div>
                            <div className="imcrm-flex imcrm-max-h-[220px] imcrm-flex-col imcrm-gap-1 imcrm-overflow-y-auto imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-p-2">
                                {exportableFields.length === 0 ? (
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                                        {__('Sin campos disponibles.')}
                                    </p>
                                ) : (
                                    exportableFields.map((f) => (
                                        <label
                                            key={f.id}
                                            className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.has(f.id)}
                                                onChange={() => toggleField(f.id)}
                                            />
                                            <span className="imcrm-truncate">
                                                {f.label}
                                                <span className="imcrm-ml-1 imcrm-text-muted-foreground">
                                                    ({f.type})
                                                </span>
                                            </span>
                                        </label>
                                    ))
                                )}
                            </div>
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {__('%d campos seleccionados de %d').replace('%d', String(selectedIds.size)).replace('%d', String(exportableFields.length))}
                            </p>
                        </div>

                        <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label className="imcrm-text-xs imcrm-font-medium">{__('Delimitador')}</Label>
                                <div className="imcrm-flex imcrm-gap-1 imcrm-rounded-md imcrm-bg-muted imcrm-p-0.5">
                                    {([
                                        { value: ',' as const, label: __('Coma (,)') },
                                        { value: ';' as const, label: __('Punto y coma (;)') },
                                    ]).map((opt) => (
                                        <button
                                            key={opt.value}
                                            type="button"
                                            onClick={() => setDelimiter(opt.value)}
                                            className={cn(
                                                'imcrm-flex-1 imcrm-rounded imcrm-px-2 imcrm-py-1 imcrm-text-[11px] imcrm-font-medium imcrm-transition-colors',
                                                delimiter === opt.value
                                                    ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm'
                                                    : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
                                            )}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                <Label className="imcrm-text-xs imcrm-font-medium">{__('Encoding')}</Label>
                                <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                                    <input
                                        type="checkbox"
                                        checked={withBom}
                                        onChange={(e) => setWithBom(e.target.checked)}
                                    />
                                    {__('UTF-8 con BOM')}
                                </label>
                                <p className="imcrm-text-[10px] imcrm-text-muted-foreground">
                                    {__('Recomendado para abrir en Excel sin romper acentos.')}
                                </p>
                            </div>
                        </div>

                        <div className="imcrm-flex imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-4">
                            <Dialog.Close asChild>
                                <Button type="button" variant="outline">
                                    {__('Cancelar')}
                                </Button>
                            </Dialog.Close>
                            <Button
                                type="button"
                                onClick={() => void run()}
                                disabled={busy || selectedIds.size === 0}
                                className="imcrm-gap-2"
                            >
                                {busy ? (
                                    <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                                ) : (
                                    <Download className="imcrm-h-4 imcrm-w-4" />
                                )}
                                {busy ? __('Exportando…') : __('Descargar CSV')}
                            </Button>
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

/**
 * Espera a que el job de export termine (status `ready` o
 * `failed`) y dispara el download del archivo. Polea cada 2s
 * hasta 5 minutos (max ~150 requests).
 *
 * Si el server marca `failed`, lanza Error con el mensaje del
 * backend para que el catch superior muestre alert.
 */
async function pollAndDownload(
    boot: ReturnType<typeof getBootData>,
    jobId: number,
): Promise<void> {
    const base = boot.restRoot.replace(/\/$/, '');
    const pollUrl = `${base}/export/jobs/${jobId}`;
    const start = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1000;
    const INTERVAL_MS = 2000;

    while (Date.now() - start < TIMEOUT_MS) {
        await new Promise((r) => setTimeout(r, INTERVAL_MS));
        const res = await fetch(pollUrl, {
            method: 'GET',
            headers: { 'X-WP-Nonce': boot.restNonce, Accept: 'application/json' },
            credentials: 'same-origin',
        });
        if (!res.ok) {
            throw new Error(`Poll HTTP ${res.status}`);
        }
        const body = (await res.json()) as {
            data: {
                status: string;
                error?: string | null;
                download_url?: string;
            };
        };
        const { status, error, download_url: downloadUrl } = body.data;

        if (status === 'ready' && downloadUrl) {
            // El download URL ya viene con el token firmado.
            // Apuntamos un <a> al endpoint — el browser dispara el
            // download nativo via Content-Disposition.
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.target = '_self';
            document.body.appendChild(a);
            a.click();
            a.remove();
            return;
        }
        if (status === 'failed') {
            throw new Error(error || 'Export job failed.');
        }
    }
    throw new Error('Export job timeout — recargá la página y revisá "Mis exports".');
}
