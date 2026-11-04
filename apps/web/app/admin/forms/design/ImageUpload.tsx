import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api } from '@/cloud/session';
import { useAttachment } from '@/hooks/useAttachments';
import { __ } from '@/lib/i18n';
import { resizeImageFile } from '@/lib/imageResize';
import { cn } from '@/lib/utils';

/**
 * v0.1.351 — Subir (o cambiar, o quitar) una imagen del diseño del
 * formulario. Antes de subirla se achica en el navegador a WebP con el lado
 * mayor que corresponde a su uso (`maxSide`); el archivo queda en el módulo de
 * archivos de la empresa y el diseño guarda sólo su id.
 */
export function ImageUpload({
    label,
    fileId,
    onChange,
    maxSide,
    hint,
    compact,
    testId,
}: {
    label: string;
    fileId: number | null;
    onChange: (id: number | null) => void;
    maxSide: number;
    hint?: string;
    /** Versión chica (una fila por opción). */
    compact?: boolean;
    testId?: string;
}): JSX.Element {
    const toast = useToast();
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [uploading, setUploading] = useState(false);
    const att = useAttachment(fileId);
    const url = att.data?.url ?? null;

    const upload = async (file: File): Promise<void> => {
        if (!file.type.startsWith('image/')) {
            toast.error(__('Eso no es una imagen'), __('Sube un PNG, JPG, WebP, GIF o SVG.'));
            return;
        }
        setUploading(true);
        try {
            const ready = await resizeImageFile(file, { maxSide });
            const { id } = await api.uploadFile(ready);
            onChange(id);
        } catch (err) {
            toast.error(__('No se pudo subir la imagen'), err instanceof Error ? err.message : String(err));
        } finally {
            setUploading(false);
        }
    };

    const picker = (
        <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            className="imcrm-hidden"
            onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = '';
            }}
            data-testid={testId ? `${testId}-input` : undefined}
        />
    );

    const thumb = (
        <div
            className={cn(
                'imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/50',
                compact ? 'imcrm-h-9 imcrm-w-12' : 'imcrm-h-16 imcrm-w-24',
            )}
        >
            {uploading ? (
                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin imcrm-text-muted-foreground" />
            ) : url ? (
                <img src={url} alt="" className="imcrm-h-full imcrm-w-full imcrm-object-cover" />
            ) : (
                <ImagePlus className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
            )}
        </div>
    );

    return (
        <div className={cn('imcrm-flex imcrm-min-w-0 imcrm-flex-col', compact ? 'imcrm-gap-1' : 'imcrm-gap-1.5')} data-testid={testId}>
            {!compact && <span className="imcrm-text-[11px] imcrm-text-muted-foreground">{label}</span>}
            {picker}
            <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                <button
                    type="button"
                    className="imcrm-rounded-md focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/40"
                    onClick={() => inputRef.current?.click()}
                    disabled={uploading}
                    aria-label={fileId !== null ? `${label} — ${__('cambiar imagen')}` : `${label} — ${__('subir imagen')}`}
                >
                    {thumb}
                </button>
                <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-1 imcrm-flex-wrap imcrm-items-center imcrm-gap-1">
                    {compact && <span className="imcrm-mr-1 imcrm-min-w-0 imcrm-truncate imcrm-text-xs">{label}</span>}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="imcrm-h-7 imcrm-gap-1 imcrm-px-2 imcrm-text-[11px]"
                        disabled={uploading}
                        onClick={() => inputRef.current?.click()}
                    >
                        {uploading ? <Loader2 className="imcrm-h-3 imcrm-w-3 imcrm-animate-spin" /> : <ImagePlus className="imcrm-h-3 imcrm-w-3" />}
                        {fileId !== null ? __('Cambiar') : __('Subir')}
                    </Button>
                    {fileId !== null && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="imcrm-h-7 imcrm-gap-1 imcrm-px-2 imcrm-text-[11px] imcrm-text-muted-foreground hover:imcrm-text-destructive"
                            disabled={uploading}
                            onClick={() => onChange(null)}
                            aria-label={`${label} — ${__('quitar imagen')}`}
                        >
                            <Trash2 className="imcrm-h-3 imcrm-w-3" />
                            {!compact && __('Quitar')}
                        </Button>
                    )}
                </div>
            </div>
            {hint && <p className="imcrm-text-[10.5px] imcrm-leading-snug imcrm-text-muted-foreground">{hint}</p>}
        </div>
    );
}
