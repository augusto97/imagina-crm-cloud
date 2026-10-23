import { useEffect, useMemo, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Download, FileSpreadsheet, FileText, Loader2, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useFields } from '@/hooks/useFields';
import { getBootData } from '@/lib/boot';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { FilterTree } from '@/types/record';

import { exportFileName, orderExportFields } from './exportFields';

interface ExportButtonProps {
    listId: number | undefined;
    listSlug: string;
    /** Filtros activos — se aplican al export (mismo subset que la vista). */
    filterTree?: FilterTree;
    /** v0.1.286 — búsqueda y orden activos: el archivo trae lo que se ve. */
    search?: string;
    /** `field_{id}:{dir},…` (vacío = sin orden). */
    sort?: string;
    /**
     * Columnas que la vista MUESTRA, en su orden (v0.1.299): son las que
     * arrancan marcadas y el orden de las columnas del archivo.
     */
    fieldIds?: number[];
    /** Nombre de la vista activa → nombre de la hoja de Excel. */
    viewName?: string;
    /** Columnas fijas de la vista → también fijas en la planilla. */
    frozenColumns?: number | null;
    disabled?: boolean;
    /**
     * Modo controlado opcional: el dialog se abre/cierra desde afuera
     * (ej. el botón compacto del breadcrumb o el menú "···" mobile de
     * RecordsPage). Si no se pasan, el estado es interno como siempre.
     */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    /** No renderiza el botón trigger propio (cuando lo abre un trigger externo). */
    hideTrigger?: boolean;
}

type ExportFormat = 'xlsx' | 'csv';
const FORMAT_KEY = 'imcrm:export-format';

function readFormat(): ExportFormat {
    try {
        return window.localStorage.getItem(FORMAT_KEY) === 'csv' ? 'csv' : 'xlsx';
    } catch {
        return 'xlsx';
    }
}

/**
 * Botón/diálogo "Exportar" de la lista y de «Exportar vista».
 *
 * v0.1.299 — dos formatos:
 *  - **Excel (.xlsx)** (por defecto): la vista tal como se ve, con cada celda
 *    de su tipo real (montos con su moneda y decimales, fechas, porcentajes,
 *    duraciones), encabezado fijo con filtro y anchos ajustados.
 *  - **CSV**: texto plano, con separador y BOM a elección.
 *
 * Ambos respetan los filtros, la búsqueda, el orden, las columnas elegidas (en
 * el orden de la vista) y el acceso de quien exporta. El último formato usado
 * se recuerda en este navegador.
 */
export function ExportButton({
    listId,
    listSlug,
    filterTree,
    search,
    sort,
    fieldIds: initialFieldIds,
    viewName,
    frozenColumns,
    disabled,
    open: controlledOpen,
    onOpenChange,
    hideTrigger,
}: ExportButtonProps): JSX.Element {
    const [internalOpen, setInternalOpen] = useState(false);
    const open = controlledOpen ?? internalOpen;
    const setOpen = onOpenChange ?? setInternalOpen;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [format, setFormat] = useState<ExportFormat>(readFormat);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [delimiter, setDelimiter] = useState<',' | ';'>(',');
    const [withBom, setWithBom] = useState(true);
    const [withSubtasks, setWithSubtasks] = useState(true);
    const [withId, setWithId] = useState(false);

    const fields = useFields(listId);

    // Primero las columnas de la vista (en su orden); después el resto.
    const exportableFields = useMemo(
        () => orderExportFields(fields.data ?? [], initialFieldIds ?? []),
        [fields.data, initialFieldIds],
    );

    // Al abrir: arrancan marcadas las columnas que la vista muestra (todas
    // si no se sabe cuáles).
    useEffect(() => {
        if (!open || !fields.data) return;
        const visible = (initialFieldIds ?? []).filter((id) => fields.data!.some((f) => f.id === id));
        setSelectedIds(new Set(visible.length > 0 ? visible : fields.data.map((f) => f.id)));
        setError(null);
    }, [open, fields.data, initialFieldIds]);

    const toggleField = (id: number): void => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const chooseFormat = (next: ExportFormat): void => {
        setFormat(next);
        try {
            window.localStorage.setItem(FORMAT_KEY, next);
        } catch {
            // Sin almacenamiento: sólo no se recuerda.
        }
    };

    const run = async (): Promise<void> => {
        setBusy(true);
        setError(null);
        try {
            const boot = getBootData();
            const params = new URLSearchParams();
            if (filterTree && filterTree.children.length > 0) {
                params.set('filter_tree', JSON.stringify(filterTree));
            }
            if (search !== undefined && search.trim() !== '') params.set('search', search.trim());
            if (sort !== undefined && sort !== '') params.set('sort', sort);
            // El orden de las columnas es el de la vista (no el del clic).
            const orderedIds = exportableFields.filter((f) => selectedIds.has(f.id)).map((f) => f.id);
            if (orderedIds.length > 0) params.set('fields', orderedIds.join(','));
            if (!withSubtasks) params.set('subtasks', '0');
            params.set('format', format);
            if (format === 'csv') {
                if (delimiter === ';') params.set('delimiter', ';');
                if (withBom) params.set('with_bom', '1');
            } else {
                if (viewName) params.set('sheet', viewName);
                if (withId) params.set('with_id', '1');
                // Fijas sólo las que siguen siendo las primeras del archivo.
                const frozen = frozenColumns ?? 0;
                const firstOrdered = (initialFieldIds ?? []).slice(0, frozen);
                if (frozen > 0 && firstOrdered.every((id, i) => orderedIds[i] === id)) params.set('freeze', String(frozen));
            }

            const base = boot.restRoot.replace(/\/$/, '');
            const url = `${base}/lists/${listSlug}/export?${params}`;
            const headers: Record<string, string> = {};
            if (boot.tenantId !== null) headers['X-Tenant-Id'] = String(boot.tenantId);

            const res = await fetch(url, { method: 'GET', headers, credentials: 'include' });
            if (!res.ok) {
                // El servidor explica por qué (p. ej. una vista demasiado grande para Excel).
                const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
                setError(typeof body?.message === 'string' && body.message !== '' ? body.message : __('No se pudo exportar. Vuelve a intentarlo.'));
                return;
            }

            const blob = await res.blob();
            const filename = exportFileName(res.headers.get('Content-Disposition') ?? '', `${listSlug}.${format}`);
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
            setError(__('No se pudo exportar. Vuelve a intentarlo.'));
        } finally {
            setBusy(false);
        }
    };

    const segmented = (active: boolean): string =>
        cn(
            'imcrm-flex imcrm-flex-1 imcrm-items-center imcrm-justify-center imcrm-gap-1.5 imcrm-rounded imcrm-px-2 imcrm-py-1.5 imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
            active ? 'imcrm-bg-card imcrm-text-foreground imcrm-shadow-imcrm-sm' : 'imcrm-text-muted-foreground hover:imcrm-text-foreground',
        );

    return (
        <Dialog.Root open={open} onOpenChange={setOpen}>
            {!hideTrigger && (
                <Dialog.Trigger asChild>
                    <Button variant="outline" disabled={disabled} className="imcrm-gap-2">
                        <Download className="imcrm-h-4 imcrm-w-4" />
                        {__('Exportar')}
                    </Button>
                </Dialog.Trigger>
            )}
            <Dialog.Portal>
                <Dialog.Overlay className="imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-md',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-max-h-[90vh] imcrm-overflow-y-auto',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg',
                    )}
                    data-testid="imcrm-export-dialog"
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <div>
                            <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                                {viewName ? sprintf(__('Exportar «%s»'), viewName) : __('Exportar registros')}
                            </Dialog.Title>
                            <Dialog.Description className="imcrm-text-sm imcrm-text-muted-foreground">
                                {filterTree && filterTree.children.length > 0
                                    ? __('Se exportan los registros filtrados, con la búsqueda y el orden de la vista.')
                                    : __('Se exportan los registros de la vista, con su búsqueda y su orden.')}
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
                            <Label className="imcrm-text-xs imcrm-font-medium">{__('Formato')}</Label>
                            <div className="imcrm-flex imcrm-gap-1 imcrm-rounded-md imcrm-bg-muted imcrm-p-0.5" role="radiogroup" aria-label={__('Formato')}>
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={format === 'xlsx'}
                                    onClick={() => chooseFormat('xlsx')}
                                    className={segmented(format === 'xlsx')}
                                    data-testid="imcrm-export-format-xlsx"
                                >
                                    <FileSpreadsheet className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                    {__('Excel (.xlsx)')}
                                </button>
                                <button
                                    type="button"
                                    role="radio"
                                    aria-checked={format === 'csv'}
                                    onClick={() => chooseFormat('csv')}
                                    className={segmented(format === 'csv')}
                                    data-testid="imcrm-export-format-csv"
                                >
                                    <FileText className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                    {__('CSV')}
                                </button>
                            </div>
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {format === 'xlsx'
                                    ? __('Montos, fechas y porcentajes como números y fechas reales de Excel; encabezado fijo con filtro. Hasta 100.000 registros.')
                                    : __('Texto plano, para otros sistemas. Sin límite de registros.')}
                            </p>
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                            <div className="imcrm-flex imcrm-items-center imcrm-justify-between">
                                <Label className="imcrm-text-xs imcrm-font-medium">{__('Columnas')}</Label>
                                <div className="imcrm-flex imcrm-gap-2 imcrm-text-[11px]">
                                    <button
                                        type="button"
                                        onClick={() => setSelectedIds(new Set(exportableFields.map((f) => f.id)))}
                                        className="imcrm-text-primary hover:imcrm-underline"
                                    >
                                        {__('Todas')}
                                    </button>
                                    <span className="imcrm-text-muted-foreground">·</span>
                                    <button
                                        type="button"
                                        onClick={() => setSelectedIds(new Set())}
                                        className="imcrm-text-primary hover:imcrm-underline"
                                    >
                                        {__('Ninguna')}
                                    </button>
                                </div>
                            </div>
                            <div className="imcrm-flex imcrm-max-h-[200px] imcrm-flex-col imcrm-gap-1 imcrm-overflow-y-auto imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-p-2">
                                {exportableFields.length === 0 ? (
                                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Sin campos disponibles.')}</p>
                                ) : (
                                    exportableFields.map((f) => (
                                        <label key={f.id} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                                            <input type="checkbox" checked={selectedIds.has(f.id)} onChange={() => toggleField(f.id)} />
                                            <span className="imcrm-truncate">{f.label}</span>
                                        </label>
                                    ))
                                )}
                            </div>
                            <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                                {sprintf(__('%1$d de %2$d columnas, en el orden de la vista.'), selectedIds.size, exportableFields.length)}
                            </p>
                        </div>

                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2">
                            <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs">
                                <input
                                    type="checkbox"
                                    checked={withSubtasks}
                                    onChange={(e) => setWithSubtasks(e.target.checked)}
                                    className="imcrm-mt-0.5"
                                    data-testid="imcrm-export-subtasks"
                                />
                                <span>
                                    {__('Incluir subtareas')}
                                    <span className="imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">
                                        {__('Con las columnas «ID» y «Subtarea de», para volver a importar la jerarquía.')}
                                    </span>
                                </span>
                            </label>
                            {format === 'xlsx' && (
                                <label className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-text-xs">
                                    <input
                                        type="checkbox"
                                        checked={withId}
                                        onChange={(e) => setWithId(e.target.checked)}
                                        className="imcrm-mt-0.5"
                                        data-testid="imcrm-export-with-id"
                                    />
                                    <span>
                                        {__('Incluir el ID de cada registro')}
                                        <span className="imcrm-block imcrm-text-[11px] imcrm-text-muted-foreground">
                                            {__('Sirve para editar el archivo y cargarlo con «Actualizar desde un archivo».')}
                                        </span>
                                    </span>
                                </label>
                            )}
                        </div>

                        {format === 'csv' && (
                            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3">
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                    <Label className="imcrm-text-xs imcrm-font-medium">{__('Separador')}</Label>
                                    <div className="imcrm-flex imcrm-gap-1 imcrm-rounded-md imcrm-bg-muted imcrm-p-0.5">
                                        {([
                                            { value: ',' as const, label: __('Coma (,)') },
                                            { value: ';' as const, label: __('Punto y coma (;)') },
                                        ]).map((opt) => (
                                            <button
                                                key={opt.value}
                                                type="button"
                                                onClick={() => setDelimiter(opt.value)}
                                                className={segmented(delimiter === opt.value)}
                                            >
                                                {opt.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                                <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                                    <Label className="imcrm-text-xs imcrm-font-medium">{__('Codificación')}</Label>
                                    <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-xs">
                                        <input type="checkbox" checked={withBom} onChange={(e) => setWithBom(e.target.checked)} />
                                        {__('UTF-8 con BOM')}
                                    </label>
                                    <p className="imcrm-text-[10px] imcrm-text-muted-foreground">
                                        {__('Recomendado para abrir en Excel sin romper los acentos.')}
                                    </p>
                                </div>
                            </div>
                        )}

                        {error !== null && (
                            <p role="alert" className="imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-destructive" data-testid="imcrm-export-error">
                                {error}
                            </p>
                        )}

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
                                data-testid="imcrm-export-run"
                            >
                                {busy ? <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" /> : <Download className="imcrm-h-4 imcrm-w-4" />}
                                {busy ? __('Exportando…') : format === 'xlsx' ? __('Descargar Excel') : __('Descargar CSV')}
                            </Button>
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
