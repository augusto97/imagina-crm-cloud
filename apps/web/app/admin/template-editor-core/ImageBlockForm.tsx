import { useRef, useState } from 'react';
import { ImagePlus, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api } from '@/cloud/session';
import { ApiError } from '@/lib/api';
import { __ } from '@/lib/i18n';

/**
 * Form del inspector para el bloque IMAGEN — compartido entre el
 * editor de plantilla del registro (CRM) y el del portal del cliente.
 *
 * Dos fuentes: subir un archivo (módulo de archivos propio →
 * `image_file_id`; el portal lo recibe como URL FIRMADA inyectada por
 * el backend) o pegar una URL externa. Config compartida:
 * `{ url, image_file_id, alt, height, fit, link_url }`.
 */
export function ImageBlockForm({
    config,
    onConfigChange,
}: {
    config: Record<string, unknown>;
    onConfigChange: (next: Record<string, unknown>) => void;
}): JSX.Element {
    const toast = useToast();
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [uploading, setUploading] = useState(false);

    const url = typeof config.url === 'string' ? config.url : '';
    const fileId = typeof config.image_file_id === 'number' ? config.image_file_id : undefined;
    const alt = typeof config.alt === 'string' ? config.alt : '';
    const height = typeof config.height === 'number' ? config.height : 0;
    const fit = config.fit === 'contain' ? 'contain' : 'cover';
    const linkUrl = typeof config.link_url === 'string' ? config.link_url : '';

    const set = (patch: Record<string, unknown>): void => {
        onConfigChange({ ...config, ...patch });
    };

    const handleUpload = async (file: File): Promise<void> => {
        setUploading(true);
        try {
            const { id } = await api.uploadFile(file);
            // El archivo subido manda; la URL externa se limpia.
            set({ image_file_id: id, url: '' });
            toast.success(__('Imagen subida'));
        } catch (err) {
            if (err instanceof ApiError || err instanceof Error) {
                toast.error(__('No se pudo subir la imagen'), err.message);
            }
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-3">
            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Imagen')}</Label>
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="imcrm-hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleUpload(f);
                            e.target.value = '';
                        }}
                    />
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="imcrm-gap-1.5"
                        disabled={uploading}
                        onClick={() => fileInputRef.current?.click()}
                    >
                        {uploading ? (
                            <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin" />
                        ) : (
                            <ImagePlus className="imcrm-h-3.5 imcrm-w-3.5" />
                        )}
                        {fileId !== undefined ? __('Cambiar imagen') : __('Subir imagen')}
                    </Button>
                    {fileId !== undefined && (
                        <span className="imcrm-text-[11px] imcrm-text-muted-foreground">
                            {__('Archivo #%d').replace('%d', String(fileId))}
                        </span>
                    )}
                </div>
                <p className="imcrm-text-[11px] imcrm-text-muted-foreground">
                    {__('… o pega la URL de una imagen pública:')}
                </p>
                <Input
                    value={url}
                    onChange={(e) => {
                        const v = e.target.value.trim();
                        // Una URL pegada manda; el archivo subido se suelta.
                        set(v === '' ? { url: '' } : { url: v, image_file_id: undefined });
                    }}
                    placeholder="https://…/imagen.png"
                />
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Texto alternativo (accesibilidad)')}</Label>
                <Input
                    value={alt}
                    onChange={(e) => set({ alt: e.target.value })}
                    placeholder={__('Descripción breve de la imagen')}
                />
            </div>

            <div className="imcrm-flex imcrm-gap-2">
                <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1.5">
                    <Label>{__('Alto (px)')}</Label>
                    <Input
                        type="number"
                        min={0}
                        value={height === 0 ? '' : height}
                        placeholder={__('Auto')}
                        onChange={(e) => {
                            const n = Number(e.target.value);
                            set({ height: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0 });
                        }}
                    />
                </div>
                <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1.5">
                    <Label>{__('Ajuste')}</Label>
                    <Select value={fit} onChange={(e) => set({ fit: e.target.value })}>
                        <option value="cover">{__('Cubrir (recorta)')}</option>
                        <option value="contain">{__('Contener (completa)')}</option>
                    </Select>
                </div>
            </div>

            <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
                <Label>{__('Enlace al hacer click (opcional)')}</Label>
                <Input
                    value={linkUrl}
                    onChange={(e) => set({ link_url: e.target.value.trim() })}
                    placeholder="https://…"
                />
            </div>
        </div>
    );
}

/**
 * Resuelve el `src` de la imagen en superficies del ADMIN (editor +
 * ficha del registro): URL externa directa, o la descarga inline del
 * módulo de archivos (misma ruta que usan los covers de tarjetas).
 * El PORTAL no usa esto — recibe la URL firmada desde el backend.
 */
export function adminImageSrc(config: Record<string, unknown>): string | undefined {
    const url = typeof config.url === 'string' && config.url !== '' ? config.url : undefined;
    if (url !== undefined) return url;
    const id = typeof config.image_file_id === 'number' && config.image_file_id > 0
        ? config.image_file_id
        : undefined;
    return id !== undefined ? `/api/v1/files/${id}/download` : undefined;
}

/** Render compartido del <img> (admin y preview del editor). */
export function ImageBlockView({
    config,
    src,
}: {
    config: Record<string, unknown>;
    /** src ya resuelto (admin: adminImageSrc; portal: config.url). */
    src: string | undefined;
}): JSX.Element {
    const alt = typeof config.alt === 'string' ? config.alt : '';
    const height = typeof config.height === 'number' && config.height > 0 ? config.height : undefined;
    const fit = config.fit === 'contain' ? 'contain' : 'cover';
    const linkUrl = typeof config.link_url === 'string' && config.link_url !== '' ? config.link_url : undefined;

    if (src === undefined) {
        return (
            <div className="imcrm-flex imcrm-h-28 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/20 imcrm-text-xs imcrm-text-muted-foreground">
                {__('Sube una imagen o pega una URL')}
            </div>
        );
    }

    const img = (
        <img
            src={src}
            alt={alt}
            loading="lazy"
            style={{
                width: '100%',
                height: height !== undefined ? `${height}px` : 'auto',
                objectFit: fit,
                display: 'block',
                borderRadius: 'inherit',
            }}
        />
    );

    if (linkUrl !== undefined) {
        return (
            <a href={linkUrl} target="_blank" rel="noreferrer noopener" style={{ display: 'block' }}>
                {img}
            </a>
        );
    }
    return img;
}
