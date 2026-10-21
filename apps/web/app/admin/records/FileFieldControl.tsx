import { useRef, useState } from 'react';
import { FileText, Loader2, Paperclip, Upload, X } from 'lucide-react';

import { openFilePreview } from '@/components/files/filePreview';
import { isPlainClick, toPreviewFile } from '@/components/files/openAttachments';
import { useAttachments, type AttachmentDto, type ResolvedAttachment } from '@/hooks/useAttachments';
import { getBootData } from '@/lib/boot';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { normalizeFileIds } from './fileIds';

/** Límite de upload del backend (ADR-S16) — espejo para cortar antes del POST. */
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

async function uploadOne(file: File): Promise<number> {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error(__('El archivo supera el tamaño máximo (20 MB).'));
    const boot = getBootData();
    // Auth: cookie de sesión + workspace activo por header (sin Content-Type
    // manual: el navegador arma el boundary del multipart).
    const headers: Record<string, string> = {};
    if (boot.tenantId !== null) headers['X-Tenant-Id'] = String(boot.tenantId);
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${boot.restRoot.replace(/\/$/, '')}/files`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: form,
    });
    const payload = (await res.json().catch(() => null)) as (Partial<AttachmentDto> & { code?: string; message?: string }) | null;
    if (!res.ok || typeof payload?.id !== 'number') {
        throw new Error(
            payload?.code === 'file_too_large'
                ? __('El archivo supera el tamaño máximo (20 MB).')
                : payload?.message ?? `HTTP ${res.status}`,
        );
    }
    return payload.id;
}

interface FileFieldControlProps {
    id: string;
    value: unknown;
    onChange: (value: unknown) => void;
    /** `config.max_files` del campo (sin tope si no está). */
    maxFiles?: number;
    /** Fila densa de la ficha (sin la caja punteada grande). */
    compact?: boolean;
}

/**
 * Control del campo Archivo (ADR-S16).
 *
 * El valor es una LISTA de ids de adjunto (`number[]`, lo que exige el
 * validador compartido). Antes el control mandaba un número suelto y la
 * ficha no podía guardar ningún archivo ("Se esperaba una lista de
 * archivos."), e ignoraba los que ya venían del formulario público o del
 * import. Ahora: muestra todos con su nombre y enlace, agrega uno o varios
 * (botón o ARRASTRANDO encima), quita de a uno y respeta `max_files`.
 */
export function FileFieldControl({ id, value, onChange, maxFiles, compact = false }: FileFieldControlProps): JSX.Element {
    const ids = normalizeFileIds(value);
    const idsRef = useRef(ids);
    idsRef.current = ids;
    const attachments = useAttachments(ids);
    const [busy, setBusy] = useState(0);
    const [uploadError, setUploadError] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const max = maxFiles !== undefined && maxFiles > 0 ? maxFiles : null;
    const full = max !== null && ids.length >= max;

    const uploadMany = async (files: File[]): Promise<void> => {
        if (files.length === 0) return;
        setUploadError(null);
        const room = max === null ? files.length : max - idsRef.current.length - busy;
        if (room <= 0) {
            setUploadError(sprintf(/* translators: %d: max files */ __('El campo admite como máximo %d archivos.'), max ?? 0));
            return;
        }
        const take = files.slice(0, room);
        if (take.length < files.length) {
            setUploadError(sprintf(/* translators: %d: max files */ __('Se agregaron sólo los que entran: el campo admite como máximo %d archivos.'), max ?? 0));
        }
        setBusy((n) => n + take.length);
        const uploaded: number[] = [];
        for (const file of take) {
            try {
                uploaded.push(await uploadOne(file));
            } catch (e) {
                setUploadError(e instanceof Error ? e.message : __('No se pudo subir el archivo.'));
            } finally {
                setBusy((n) => n - 1);
            }
        }
        if (uploaded.length > 0) onChange([...idsRef.current, ...uploaded]);
        // Reset para que elegir el mismo archivo dos veces vuelva a disparar.
        if (inputRef.current) inputRef.current.value = '';
    };

    const remove = (fileId: number): void => {
        onChange(idsRef.current.filter((x) => x !== fileId));
    };

    return (
        <div
            className={cn(
                'imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-rounded-md imcrm-transition-colors',
                dragOver && 'imcrm-bg-primary/5 imcrm-outline imcrm-outline-2 imcrm-outline-dashed imcrm-outline-primary/60',
            )}
            data-testid="imcrm-file-control"
            onDragOver={(e) => {
                if (!Array.from(e.dataTransfer.types).includes('Files')) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = full ? 'none' : 'copy';
                setDragOver(true);
            }}
            onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setDragOver(false);
            }}
            onDrop={(e) => {
                if (!Array.from(e.dataTransfer.types).includes('Files')) return;
                e.preventDefault();
                setDragOver(false);
                void uploadMany(Array.from(e.dataTransfer.files));
            }}
        >
            {ids.length > 0 && (
                <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                    {ids.map((fileId) => {
                        const resolved = attachments.data?.get(fileId) ?? null;
                        const name = resolved?.title ?? sprintf(/* translators: %d: file id */ __('Archivo #%d'), fileId);
                        return (
                            <li
                                key={fileId}
                                className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2.5 imcrm-py-1.5 imcrm-text-sm"
                                data-testid="imcrm-file-item"
                            >
                                <FileText className="imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
                                {resolved !== null ? (
                                    <a
                                        href={resolved.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                                        data-testid="imcrm-file-link"
                                        onClick={(e) => {
                                            // v0.1.288 — un click abre el visor; Ctrl/⌘+click, otra pestaña.
                                            if (!isPlainClick(e)) return;
                                            e.preventDefault();
                                            const all = ids.map((x) => attachments.data?.get(x)).filter((a): a is ResolvedAttachment => a !== undefined);
                                            openFilePreview(all.map(toPreviewFile), Math.max(0, all.findIndex((a) => a.id === fileId)));
                                        }}
                                    >
                                        {name}
                                    </a>
                                ) : (
                                    <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate imcrm-text-muted-foreground">{name}</span>
                                )}
                                <button
                                    type="button"
                                    onClick={() => remove(fileId)}
                                    aria-label={sprintf(/* translators: %s: file name */ __('Quitar «%s»'), name)}
                                    title={__('Quitar')}
                                    className="imcrm-inline-flex imcrm-h-6 imcrm-w-6 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded imcrm-text-muted-foreground hover:imcrm-bg-destructive/10 hover:imcrm-text-destructive"
                                >
                                    <X className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}

            {!full && (
                <div
                    className={cn(
                        'imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-2 imcrm-gap-y-1 imcrm-text-xs imcrm-text-muted-foreground',
                        !compact && ids.length === 0 && 'imcrm-rounded-md imcrm-border imcrm-border-dashed imcrm-border-input imcrm-px-3 imcrm-py-2.5',
                    )}
                >
                    <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        disabled={busy > 0}
                        className="imcrm-inline-flex imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2.5 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-foreground hover:imcrm-bg-accent disabled:imcrm-opacity-60"
                    >
                        {ids.length === 0 ? <Upload className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden /> : <Paperclip className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />}
                        {ids.length === 0 ? __('Subir archivo') : __('Agregar otro')}
                    </button>
                    <span>{__('o arrástralo aquí')}</span>
                    {busy > 0 && (
                        <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1">
                            <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" aria-hidden />
                            {__('Subiendo…')}
                        </span>
                    )}
                    <input
                        id={id}
                        ref={inputRef}
                        type="file"
                        multiple={max === null || max - ids.length > 1}
                        hidden
                        onChange={(e) => void uploadMany(Array.from(e.target.files ?? []))}
                    />
                </div>
            )}
            {full && max !== null && (
                <span className="imcrm-text-xs imcrm-text-muted-foreground">
                    {sprintf(/* translators: %d: max files */ __('Máximo %d archivos: quita uno para subir otro.'), max)}
                </span>
            )}
            {uploadError !== null && <span className="imcrm-text-xs imcrm-text-destructive">{uploadError}</span>}
        </div>
    );
}
