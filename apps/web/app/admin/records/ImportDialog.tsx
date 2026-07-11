import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, FileUp, Loader2, Plus, TriangleAlert, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { api, ApiError } from '@/lib/api';
import { fieldsKeys } from '@/hooks/useFields';
import { recordsKeys } from '@/hooks/useRecords';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface ImportDialogProps {
    listId: number;
    listSlug: string;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

interface PreviewResponse {
    headers: string[];
    sample: string[][];
    total_rows: number;
    suggested_mapping: Record<string, string>;
    suggested_types: Record<string, string>;
    fields: Array<{
        id: number;
        slug: string;
        label: string;
        type: string;
        is_required?: boolean;
    }>;
}

interface NewFieldSpec {
    label: string;
    type: string;
}

interface RunResponse {
    imported: number;
    skipped: number;
    errors: Array<{ row: number; message: string }>;
    truncated: boolean;
    created_fields: Array<{ slug: string; label: string; type: string }>;
    /**
     * Opciones auto-creadas en campos `select`/`multi_select` cuando el
     * CSV traía valores que no existían en el config del campo.
     * Map de `field_slug → [{value, label}, …]`.
     */
    expanded_options: Record<string, Array<{ value: string; label: string }>>;
    /**
     * 0.36.5: celdas con datos que NO se importaron por silent drop
     * (raw no parseable al tipo del field — ej. fecha en formato
     * raro, multi_select con todos items vacíos). Antes se perdían
     * sin avisar al user.
     */
    cell_warnings: Array<{
        row: number;
        column_index: number;
        header: string;
        field_slug: string;
        field_label: string;
        field_type: string;
        raw: string;
        reason: 'coerce_empty';
    }>;
    /**
     * 0.36.5: columnas del CSV que el user dejó SIN mapping pero
     * traían datos. Estos datos no se importaron — antes el dialog
     * decía "X registros importados" sin avisar.
     */
    unmapped_columns_with_data: Array<{
        column_index: number;
        header: string;
        rows_with_data: number;
        sample: string;
    }>;
}

/** Tipos disponibles para la UI de "crear campo nuevo". Coinciden con los slugs del FieldTypeRegistry. */
const CREATABLE_TYPES: Array<{ slug: string; label: string }> = [
    { slug: 'text', label: __('Texto') },
    { slug: 'long_text', label: __('Texto largo') },
    { slug: 'number', label: __('Número') },
    { slug: 'currency', label: __('Moneda') },
    { slug: 'select', label: __('Selección') },
    { slug: 'multi_select', label: __('Multi-selección') },
    { slug: 'date', label: __('Fecha') },
    { slug: 'datetime', label: __('Fecha y hora') },
    { slug: 'checkbox', label: __('Checkbox') },
    { slug: 'url', label: __('URL') },
    { slug: 'email', label: __('Email') },
];

type Step = 'upload' | 'map' | 'done';

/**
 * Importa registros desde un CSV (export de ClickUp / Airtable / Excel
 * "Save as CSV" / Google Sheets) hacia una lista de Imagina CRM.
 *
 * Flujo en tres pasos:
 *  1. Upload — el usuario selecciona el archivo. Lo leemos como texto
 *     en el browser (FileReader, no upload binario) y POST a `/preview`.
 *  2. Map — backend devolvió cabeceras + muestra + sugerencia de
 *     mapping. El usuario ajusta `csv_column_idx → field_slug` y
 *     dispara el run.
 *  3. Done — summary con `imported / skipped / errors[]`.
 *
 * No subimos el CSV vía multipart por simplicidad — para CSVs típicos
 * (< 5 MB) el body inline es más fácil de manejar y suficiente.
 */
export function ImportDialog({
    listId,
    listSlug,
    open,
    onOpenChange,
}: ImportDialogProps): JSX.Element {
    const qc = useQueryClient();
    const [step, setStep] = useState<Step>('upload');
    const [csv, setCsv] = useState<string>('');
    const [fileName, setFileName] = useState<string>('');
    const [preview, setPreview] = useState<PreviewResponse | null>(null);
    const [mapping, setMapping] = useState<Record<number, string>>({});
    // Columnas marcadas como "crear campo nuevo": csv_idx → {label,type}.
    // Es exclusivo con `mapping`: una columna está o en uno o en el otro
    // (o en ninguno = ignorar).
    const [newFields, setNewFields] = useState<Record<number, NewFieldSpec>>({});
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<boolean>(false);
    const [result, setResult] = useState<RunResponse | null>(null);

    const reset = (): void => {
        setStep('upload');
        setCsv('');
        setFileName('');
        setPreview(null);
        setMapping({});
        setNewFields({});
        setError(null);
        setResult(null);
    };

    const handleFile = (file: File): void => {
        setError(null);
        setFileName(file.name);
        const reader = new FileReader();
        reader.onload = async () => {
            const text = typeof reader.result === 'string' ? reader.result : '';
            if (text === '') {
                setError(__('El archivo está vacío o no se pudo leer como texto.'));
                return;
            }
            setCsv(text);
            setBusy(true);
            try {
                const res = await api.post<PreviewResponse>(
                    `/lists/${listSlug}/import/preview`,
                    { csv: text },
                );
                if (!res.data || typeof res.data !== 'object' || !Array.isArray(res.data.headers)) {
                    // Defensa: si el backend devuelve algo inesperado,
                    // mostramos algo más útil que un crash silencioso.
                    throw new Error(__('Respuesta inesperada del servidor (sin cabeceras).'));
                }
                setPreview(res.data);
                setMapping(
                    Object.fromEntries(
                        Object.entries(res.data.suggested_mapping ?? {}).map(([k, v]) => [Number(k), v]),
                    ),
                );
                setStep('map');
            } catch (err) {
                 
                console.error('[imcrm import] preview failed:', err);
                if (err instanceof ApiError) {
                    setError(err.message);
                } else if (err instanceof Error) {
                    setError(err.message);
                } else {
                    setError(__('No se pudo leer el archivo.'));
                }
            } finally {
                setBusy(false);
            }
        };
        reader.onerror = () => {
            setError(__('No se pudo leer el archivo (FileReader error).'));
        };
        // CSV es siempre texto plano; UTF-8 con fallback Latin-1 lo
        // maneja el backend (CsvParser).
        reader.readAsText(file, 'UTF-8');
    };

    const runImport = async (): Promise<void> => {
        if (preview === null) return;
        setBusy(true);
        setError(null);
        try {
            // Filtramos las columnas con slug vacío (= "no importar").
            const cleanMapping: Record<number, string> = {};
            for (const [k, v] of Object.entries(mapping)) {
                if (v && v !== '') cleanMapping[Number(k)] = v;
            }
            // Convertimos newFields al shape que espera el backend.
            const newFieldsPayload = Object.entries(newFields)
                .filter(([, spec]) => spec.label.trim() !== '')
                .map(([idx, spec]) => ({
                    csv_column_index: Number(idx),
                    label: spec.label.trim(),
                    type: spec.type,
                }));
            if (
                Object.keys(cleanMapping).length === 0
                && newFieldsPayload.length === 0
            ) {
                setError(__('Mapea al menos una columna a un campo (existente o nuevo).'));
                setBusy(false);
                return;
            }
            const res = await api.post<RunResponse>(
                `/lists/${listSlug}/import/run`,
                {
                    csv,
                    mapping: cleanMapping,
                    new_fields: newFieldsPayload,
                },
            );
            setResult(res.data);
            setStep('done');
            // Invalida queries de records y fields (creamos campos nuevos).
            // Usamos las factories — los hooks indexan por `String(listId)`
            // y un keyArray manual con `listId` numérico no matchearía
            // (TanStack Query compara cada posición por igualdad estricta).
            await qc.invalidateQueries({ queryKey: recordsKeys.forList(listId) });
            await qc.invalidateQueries({ queryKey: fieldsKeys.forList(listId) });
        } catch (err) {
            setError(err instanceof ApiError ? err.message : __('Error al importar.'));
        } finally {
            setBusy(false);
        }
    };

    const close = (): void => {
        onOpenChange(false);
        // Pequeño delay para que el usuario no vea el reset durante el
        // close transition.
        setTimeout(reset, 200);
    };

    return (
        <Dialog.Root open={open} onOpenChange={(o) => (o ? onOpenChange(true) : close())}>
            <Dialog.Portal>
                <Dialog.Overlay
                    className={cn(
                        'imcrm-fixed imcrm-inset-0 imcrm-z-50 imcrm-bg-black/40 imcrm-backdrop-blur-sm',
                    )}
                />
                <Dialog.Content
                    className={cn(
                        'imcrm-fixed imcrm-left-1/2 imcrm-top-1/2 imcrm-z-50 imcrm-w-[calc(100%-1.5rem)] imcrm-max-w-3xl',
                        'imcrm--translate-x-1/2 imcrm--translate-y-1/2',
                        'imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-6 imcrm-shadow-imcrm-lg',
                        'imcrm-max-h-[90vh] imcrm-overflow-y-auto',
                    )}
                >
                    <div className="imcrm-flex imcrm-items-start imcrm-justify-between imcrm-gap-2">
                        <Dialog.Title className="imcrm-text-base imcrm-font-semibold">
                            {__('Importar desde CSV')}
                        </Dialog.Title>
                        <Dialog.Close asChild>
                            <Button variant="ghost" size="icon" aria-label={__('Cerrar')}>
                                <X className="imcrm-h-4 imcrm-w-4" />
                            </Button>
                        </Dialog.Close>
                    </div>

                    <p className="imcrm-mt-1 imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Acepta exports de ClickUp, Airtable, Excel (Guardar como CSV) y Google Sheets. Detecta delimiter (`,` / `;` / tab) y encoding automáticamente.')}
                    </p>

                    {error !== null && (
                        <div className="imcrm-mt-3 imcrm-rounded-md imcrm-border imcrm-border-destructive/40 imcrm-bg-destructive/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-destructive">
                            {error}
                        </div>
                    )}

                    <div className="imcrm-mt-4">
                        {step === 'upload' && (
                            <UploadStep busy={busy} onFile={handleFile} fileName={fileName} />
                        )}
                        {step === 'map' && preview !== null && (
                            <MapStep
                                preview={preview}
                                mapping={mapping}
                                newFields={newFields}
                                onMappingChange={setMapping}
                                onNewFieldsChange={setNewFields}
                            />
                        )}
                        {step === 'done' && result !== null && (
                            <DoneStep result={result} />
                        )}
                    </div>

                    <div className="imcrm-mt-5 imcrm-flex imcrm-justify-end imcrm-gap-2 imcrm-border-t imcrm-border-border imcrm-pt-4">
                        {step === 'map' && (
                            <>
                                <Button variant="outline" onClick={() => setStep('upload')}>
                                    {__('Atrás')}
                                </Button>
                                <Button onClick={runImport} disabled={busy} className="imcrm-gap-2">
                                    {busy && <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />}
                                    {__('Importar')}
                                </Button>
                            </>
                        )}
                        {step === 'done' && (
                            <>
                                <Button
                                    variant="outline"
                                    onClick={() => {
                                        // Volver al map step preservando csv + mapping +
                                        // newFields. Útil cuando el run trajo errores
                                        // (campos obligatorios sin mapear, fechas inválidas)
                                        // y el user quiere ajustar y re-correr sin tener
                                        // que re-subir el CSV ni re-mapear todo.
                                        setResult(null);
                                        setError(null);
                                        setStep('map');
                                    }}
                                >
                                    {__('Volver al mapeo')}
                                </Button>
                                <Button onClick={close}>{__('Cerrar')}</Button>
                            </>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

function UploadStep({
    busy,
    onFile,
    fileName,
}: {
    busy: boolean;
    onFile: (f: File) => void;
    fileName: string;
}): JSX.Element {
    return (
        <label
            className={cn(
                'imcrm-flex imcrm-cursor-pointer imcrm-flex-col imcrm-items-center imcrm-justify-center imcrm-gap-3 imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/20 imcrm-p-10 imcrm-text-center hover:imcrm-bg-muted/40',
                busy && 'imcrm-pointer-events-none imcrm-opacity-60',
            )}
        >
            <FileUp className="imcrm-h-8 imcrm-w-8 imcrm-text-muted-foreground" />
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                <span className="imcrm-text-sm imcrm-font-medium imcrm-text-foreground">
                    {fileName !== '' ? fileName : __('Selecciona un archivo CSV')}
                </span>
                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                    {__('Click o arrastra. Tamaño máximo recomendado: 5 MB / 5 000 filas.')}
                </span>
            </div>
            {busy && <Loader2 className="imcrm-h-5 imcrm-w-5 imcrm-animate-spin imcrm-text-muted-foreground" />}
            <input
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) onFile(f);
                }}
                className="imcrm-sr-only"
                disabled={busy}
            />
        </label>
    );
}

function MapStep({
    preview,
    mapping,
    newFields,
    onMappingChange,
    onNewFieldsChange,
}: {
    preview: PreviewResponse;
    mapping: Record<number, string>;
    newFields: Record<number, NewFieldSpec>;
    onMappingChange: (next: Record<number, string>) => void;
    onNewFieldsChange: (next: Record<number, NewFieldSpec>) => void;
}): JSX.Element {
    // Token sentinel del select cuando el usuario elige "crear campo
    // nuevo" — no es un slug real, lo interceptamos antes de
    // persistirlo en el mapping.
    const NEW_TOKEN = '__new__';

    const onSelectChange = (idx: number, value: string, defaultLabel: string, defaultType: string): void => {
        if (value === NEW_TOKEN) {
            // Mover de mapping → newFields.
            const m = { ...mapping };
            delete m[idx];
            onMappingChange(m);
            onNewFieldsChange({
                ...newFields,
                [idx]: { label: defaultLabel || `Columna ${idx + 1}`, type: defaultType },
            });
            return;
        }
        // Cambiar a un campo existente (o ignorar) — limpiar newFields[idx] si lo había.
        if (newFields[idx]) {
            const nf = { ...newFields };
            delete nf[idx];
            onNewFieldsChange(nf);
        }
        const m = { ...mapping };
        if (value === '') {
            delete m[idx];
        } else {
            m[idx] = value;
        }
        onMappingChange(m);
    };

    const updateNewField = (idx: number, patch: Partial<NewFieldSpec>): void => {
        const current = newFields[idx];
        if (!current) return;
        onNewFieldsChange({ ...newFields, [idx]: { ...current, ...patch } });
    };

    const newCount = Object.keys(newFields).length;

    // Campos obligatorios de la lista que no quedaron mapeados a
    // ninguna columna del CSV — el run los va a rechazar fila por
    // fila con "Este campo es obligatorio". Aviso preventivo así el
    // user lo arregla antes (o desactiva la obligatoriedad en la
    // configuración de la lista).
    const mappedSlugs = new Set(Object.values(mapping));
    const unmappedRequired = preview.fields.filter(
        (f) => f.is_required && !mappedSlugs.has(f.slug),
    );

    // Columnas sin mapping NI marcadas como "crear nuevo" que tienen
    // datos en el sample → advertencia para que el user no pierda
    // datos sin darse cuenta.
    const unmappedWithData = preview.headers.reduce<Array<{ idx: number; header: string; sample: string }>>(
        (acc, header, idx) => {
            if (mapping[idx] !== undefined) return acc;
            if (newFields[idx] !== undefined) return acc;
            const firstNonEmpty = preview.sample
                .map((row) => (row[idx] ?? '').trim())
                .find((v) => v !== '');
            if (firstNonEmpty && firstNonEmpty !== '') {
                acc.push({ idx, header, sample: firstNonEmpty });
            }
            return acc;
        },
        [],
    );

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-text-xs imcrm-text-muted-foreground">
                <span>
                    {preview.total_rows.toLocaleString()} {__('filas detectadas')} ·{' '}
                    {preview.headers.length} {__('columnas')}
                    {newCount > 0 && (
                        <>
                            {' · '}
                            <span className="imcrm-font-medium imcrm-text-primary">
                                {newCount} {__('campo(s) nuevo(s)')}
                            </span>
                        </>
                    )}
                </span>
                <span>{__('Mapea o crea campos nuevos. "—" ignora la columna.')}</span>
            </div>

            {unmappedWithData.length > 0 && (
                <div className="imcrm-rounded-md imcrm-border imcrm-border-warning/50 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-foreground">
                    <span className="imcrm-font-medium imcrm-text-warning">
                        ⚠ {__('Atención — columnas con datos sin mapear:')}
                    </span>{' '}
                    {__('los datos de estas columnas se PERDERÁN si seguís así. Mapealas a un campo existente o usá "Crear campo nuevo".')}
                    <ul className="imcrm-mt-1 imcrm-flex imcrm-flex-col imcrm-gap-0.5">
                        {unmappedWithData.map((c) => (
                            <li key={c.idx}>
                                <span className="imcrm-font-medium">{c.header || `#${c.idx}`}</span>
                                {' — '}
                                <span className="imcrm-italic imcrm-text-muted-foreground">
                                    &ldquo;{c.sample}&rdquo;
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {unmappedRequired.length > 0 && (
                <div className="imcrm-rounded-md imcrm-border imcrm-border-warning/50 imcrm-bg-warning/10 imcrm-px-3 imcrm-py-2 imcrm-text-xs imcrm-text-foreground">
                    <span className="imcrm-font-medium">{__('Atención:')}</span>{' '}
                    {__('los siguientes campos son obligatorios y no están mapeados — todas las filas fallarán hasta que los mapees o desactives su obligatoriedad en la configuración de la lista:')}
                    <ul className="imcrm-mt-1 imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                        {unmappedRequired.map((f) => (
                            <li
                                key={f.slug}
                                className="imcrm-rounded imcrm-border imcrm-border-warning/40 imcrm-bg-card imcrm-px-1.5 imcrm-py-0.5"
                            >
                                {f.label} <span className="imcrm-text-muted-foreground">({f.type})</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div className="imcrm-overflow-auto imcrm-rounded-md imcrm-border imcrm-border-border">
                <table className="imcrm-w-full imcrm-text-xs">
                    <thead className="imcrm-bg-muted/30 imcrm-text-left imcrm-text-muted-foreground">
                        <tr>
                            <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Columna CSV')}</th>
                            <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Campo destino')}</th>
                            <th className="imcrm-px-2 imcrm-py-2 imcrm-font-medium">{__('Ejemplos')}</th>
                        </tr>
                    </thead>
                    <tbody>
                        {preview.headers.map((header, idx) => {
                            const examples = preview.sample
                                .slice(0, 3)
                                .map((r) => r[idx] ?? '')
                                .filter((v) => v !== '');
                            const isNew = newFields[idx] !== undefined;
                            const selectValue = isNew
                                ? NEW_TOKEN
                                : (mapping[idx] ?? '');
                            const suggestedType = preview.suggested_types?.[String(idx)] ?? 'text';
                            return (
                                <tr key={idx} className="imcrm-border-t imcrm-border-border imcrm-align-top">
                                    <td className="imcrm-px-2 imcrm-py-2 imcrm-font-medium imcrm-text-foreground">
                                        {header || `(${__('columna')} ${idx + 1})`}
                                    </td>
                                    <td className="imcrm-px-2 imcrm-py-2">
                                        <Select
                                            value={selectValue}
                                            onChange={(e) =>
                                                onSelectChange(idx, e.target.value, header, suggestedType)
                                            }
                                            className="imcrm-h-8"
                                        >
                                            <option value="">{__('— Ignorar —')}</option>
                                            <optgroup label={__('Campos existentes')}>
                                                {preview.fields.map((f) => (
                                                    <option key={f.id} value={f.slug}>
                                                        {f.label} ({f.type})
                                                    </option>
                                                ))}
                                            </optgroup>
                                            <option value={NEW_TOKEN}>
                                                + {__('Crear campo nuevo')}
                                            </option>
                                        </Select>
                                        {isNew && (
                                            <div className="imcrm-mt-1.5 imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-p-2">
                                                <Input
                                                    value={newFields[idx]!.label}
                                                    onChange={(e) =>
                                                        updateNewField(idx, { label: e.target.value })
                                                    }
                                                    placeholder={__('Nombre del campo')}
                                                    className="imcrm-h-7 imcrm-text-xs"
                                                />
                                                <Select
                                                    value={newFields[idx]!.type}
                                                    onChange={(e) =>
                                                        updateNewField(idx, { type: e.target.value })
                                                    }
                                                    className="imcrm-h-7"
                                                >
                                                    {CREATABLE_TYPES.map((t) => (
                                                        <option key={t.slug} value={t.slug}>
                                                            {t.label}
                                                        </option>
                                                    ))}
                                                </Select>
                                                <p className="imcrm-text-[10px] imcrm-text-muted-foreground">
                                                    <Plus className="imcrm-inline imcrm-h-2.5 imcrm-w-2.5" />
                                                    {' '}
                                                    {__('Tipo sugerido por los datos:')} <span className="imcrm-font-medium">{suggestedType}</span>
                                                </p>
                                            </div>
                                        )}
                                    </td>
                                    <td className="imcrm-px-2 imcrm-py-2 imcrm-text-muted-foreground imcrm-truncate imcrm-max-w-xs">
                                        {examples.join(' · ') || '—'}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            <p className="imcrm-text-[10px] imcrm-text-muted-foreground">
                {__('Las columnas no mapeadas se ignoran. Filas con errores de validación se reportan al final; el resto se importa igual. Los campos nuevos se crean en la lista antes de empezar el insert.')}
            </p>
        </div>
    );
}

function DoneStep({ result }: { result: RunResponse }): JSX.Element {
    const hasDataLoss =
        (result.cell_warnings?.length ?? 0) > 0
        || (result.unmapped_columns_with_data?.length ?? 0) > 0;

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div
                className={
                    hasDataLoss
                        ? 'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-warning/40 imcrm-bg-warning/10 imcrm-p-3 imcrm-text-sm imcrm-text-foreground'
                        : 'imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-success/40 imcrm-bg-success/10 imcrm-p-3 imcrm-text-sm imcrm-text-foreground'
                }
            >
                {hasDataLoss ? (
                    <TriangleAlert className="imcrm-h-5 imcrm-w-5 imcrm-text-warning" />
                ) : (
                    <CheckCircle2 className="imcrm-h-5 imcrm-w-5 imcrm-text-success" />
                )}
                <span>
                    {result.imported.toLocaleString()} {__('registros importados')}
                    {result.skipped > 0 && (
                        <>
                            {' · '}
                            <span className="imcrm-text-muted-foreground">
                                {result.skipped.toLocaleString()} {__('omitidos')}
                            </span>
                        </>
                    )}
                    {hasDataLoss && (
                        <>
                            {' · '}
                            <span className="imcrm-font-medium imcrm-text-warning">
                                {__('Hay datos perdidos — revisá abajo')}
                            </span>
                        </>
                    )}
                </span>
            </div>

            {result.unmapped_columns_with_data && result.unmapped_columns_with_data.length > 0 && (
                <div className="imcrm-rounded-md imcrm-border imcrm-border-warning/40 imcrm-bg-warning/5 imcrm-p-3 imcrm-text-xs">
                    <p className="imcrm-mb-1.5 imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium imcrm-text-warning">
                        <TriangleAlert className="imcrm-h-3.5 imcrm-w-3.5" />
                        {__('Columnas del CSV con datos que NO se importaron (sin mapping):')}
                    </p>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        {result.unmapped_columns_with_data.map((c) => (
                            <li key={c.column_index} className="imcrm-text-foreground">
                                <span className="imcrm-font-medium">{c.header || `#${c.column_index}`}</span>
                                {' — '}
                                <span className="imcrm-text-muted-foreground">
                                    {c.rows_with_data.toLocaleString()} {__('filas con datos')}
                                </span>
                                {c.sample && (
                                    <>
                                        {' · '}
                                        <span className="imcrm-text-muted-foreground imcrm-italic">
                                            &ldquo;{c.sample}&rdquo;
                                        </span>
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                    <p className="imcrm-mt-2 imcrm-text-[11px] imcrm-text-muted-foreground">
                        {__('Para importar estos datos: volvé a empezar y mapealas a un campo existente o pedí "Crear campo nuevo".')}
                    </p>
                </div>
            )}

            {result.cell_warnings && result.cell_warnings.length > 0 && (
                <details className="imcrm-rounded-md imcrm-border imcrm-border-warning/40 imcrm-bg-warning/5 imcrm-p-3 imcrm-text-xs">
                    <summary className="imcrm-cursor-pointer imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium imcrm-text-warning">
                        <TriangleAlert className="imcrm-h-3.5 imcrm-w-3.5" />
                        {result.cell_warnings.length.toLocaleString()} {__('celdas con datos NO importadas (click para detalles)')}
                    </summary>
                    <p className="imcrm-mt-2 imcrm-text-muted-foreground">
                        {__('Estos valores no pudieron convertirse al tipo del campo. Comunes: fechas en formato no reconocido, multi_select con items vacíos, números con caracteres no numéricos.')}
                    </p>
                    <ul className="imcrm-mt-2 imcrm-flex imcrm-max-h-64 imcrm-flex-col imcrm-gap-1 imcrm-overflow-y-auto imcrm-tabular-nums imcrm-text-muted-foreground">
                        {result.cell_warnings.slice(0, 100).map((w, i) => (
                            <li key={i}>
                                <span className="imcrm-font-medium">{__('Fila')} {w.row}:</span>{' '}
                                <span className="imcrm-text-foreground">{w.field_label}</span>
                                {' ('}
                                <span className="imcrm-italic">{w.field_type}</span>
                                {') '}
                                {__('valor "')}
                                <span className="imcrm-italic imcrm-text-foreground">{w.raw}</span>
                                {__('" no se pudo procesar')}
                            </li>
                        ))}
                        {result.cell_warnings.length > 100 && (
                            <li className="imcrm-italic">
                                +{result.cell_warnings.length - 100} {__('más')}
                            </li>
                        )}
                    </ul>
                </details>
            )}
            {result.created_fields && result.created_fields.length > 0 && (
                <div className="imcrm-rounded-md imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-p-3 imcrm-text-xs">
                    <p className="imcrm-mb-1.5 imcrm-font-medium imcrm-text-foreground">
                        {result.created_fields.length} {__('campo(s) nuevo(s) creado(s):')}
                    </p>
                    <ul className="imcrm-flex imcrm-flex-wrap imcrm-gap-1.5">
                        {result.created_fields.map((f) => (
                            <li
                                key={f.slug}
                                className="imcrm-rounded imcrm-border imcrm-border-primary/30 imcrm-bg-card imcrm-px-1.5 imcrm-py-0.5 imcrm-text-foreground"
                            >
                                {f.label} <span className="imcrm-text-muted-foreground">({f.type})</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {result.expanded_options && Object.keys(result.expanded_options).length > 0 && (
                <div className="imcrm-rounded-md imcrm-border imcrm-border-primary/30 imcrm-bg-primary/5 imcrm-p-3 imcrm-text-xs">
                    <p className="imcrm-mb-1.5 imcrm-font-medium imcrm-text-foreground">
                        {__('Opciones auto-creadas en campos de selección:')}
                    </p>
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                        {Object.entries(result.expanded_options).map(([slug, opts]) => (
                            <li key={slug} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1">
                                <span className="imcrm-font-medium imcrm-text-foreground">{slug}:</span>
                                {opts.map((o) => (
                                    <span
                                        key={o.value}
                                        className="imcrm-rounded imcrm-border imcrm-border-primary/30 imcrm-bg-card imcrm-px-1.5 imcrm-py-0.5 imcrm-text-foreground"
                                    >
                                        {o.label}
                                    </span>
                                ))}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            {result.truncated && (
                <p className="imcrm-text-xs imcrm-text-warning">
                    {__('Se procesaron las primeras 5 000 filas. Vuelve a ejecutar el import con el resto del archivo.')}
                </p>
            )}
            {result.errors.length > 0 && (
                <details className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-card imcrm-p-3 imcrm-text-xs">
                    <summary className="imcrm-cursor-pointer imcrm-font-medium imcrm-text-destructive">
                        {result.errors.length.toLocaleString()} {__('filas con errores (click para ver detalles)')}
                    </summary>
                    <ul className="imcrm-mt-2 imcrm-flex imcrm-max-h-48 imcrm-flex-col imcrm-gap-1 imcrm-overflow-y-auto imcrm-text-muted-foreground">
                        {result.errors.slice(0, 50).map((e, i) => (
                            <li key={i} className="imcrm-tabular-nums">
                                <span className="imcrm-font-medium">{__('Fila')} {e.row}:</span> {e.message}
                            </li>
                        ))}
                        {result.errors.length > 50 && (
                            <li className="imcrm-italic">
                                +{result.errors.length - 50} {__('más')}
                            </li>
                        )}
                    </ul>
                </details>
            )}
        </div>
    );
}
