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

/**
 * v0.1.94 — Form del bloque ESPACIADOR: solo alto en px. Útil para
 * respirar entre secciones sin recurrir a márgenes manuales.
 */
export function SpacerBlockForm({
    config,
    onConfigChange,
}: {
    config: Record<string, unknown>;
    onConfigChange: (next: Record<string, unknown>) => void;
}): JSX.Element {
    const height = typeof config.height === 'number' && config.height > 0 ? config.height : 32;
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-gap-1.5">
            <Label>{__('Alto del espacio (px)')}</Label>
            <Input
                type="number"
                min={4}
                max={400}
                value={height}
                onChange={(e) => {
                    const n = Number(e.target.value);
                    onConfigChange({
                        ...config,
                        height: Number.isFinite(n) ? Math.min(400, Math.max(4, Math.floor(n))) : 32,
                    });
                }}
            />
        </div>
    );
}

/** Render del espaciador (editor + superficies reales). */
export function SpacerBlockView({ config }: { config: Record<string, unknown> }): JSX.Element {
    const height = typeof config.height === 'number' && config.height > 0 ? config.height : 32;
    return <div style={{ height: `${height}px` }} aria-hidden />;
}

export interface GalleryImage {
    url?: string;
    image_file_id?: number;
    alt?: string;
}

export function readGalleryImages(config: Record<string, unknown>): GalleryImage[] {
    const raw = config.images;
    if (!Array.isArray(raw)) return [];
    return raw.filter((i): i is GalleryImage => !!i && typeof i === 'object');
}

/**
 * v0.1.94 — Form del bloque GALERÍA: lista de imágenes (subir o URL),
 * columnas 2-4 y alto por celda. Cada imagen se puede quitar.
 */
export function GalleryBlockForm({
    config,
    onConfigChange,
}: {
    config: Record<string, unknown>;
    onConfigChange: (next: Record<string, unknown>) => void;
}): JSX.Element {
    const toast = useToast();
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [uploading, setUploading] = useState(false);
    const images = readGalleryImages(config);
    const columns = typeof config.columns === 'number' ? Math.min(4, Math.max(2, config.columns)) : 3;
    const height = typeof config.height === 'number' && config.height > 0 ? config.height : 140;
    const [urlDraft, setUrlDraft] = useState('');

    const set = (patch: Record<string, unknown>): void => onConfigChange({ ...config, ...patch });

    const addUpload = async (file: File): Promise<void> => {
        setUploading(true);
        try {
            const { id } = await api.uploadFile(file);
            set({ images: [...images, { image_file_id: id }] });
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
                <Label>{__('Imágenes (%d)').replace('%d', String(images.length))}</Label>
                {images.length > 0 && (
                    <ul className="imcrm-flex imcrm-flex-col imcrm-gap-1">
                        {images.map((img, i) => (
                            <li
                                key={i}
                                className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/20 imcrm-px-2 imcrm-py-1"
                            >
                                <span className="imcrm-flex-1 imcrm-truncate imcrm-text-[11px] imcrm-text-muted-foreground">
                                    {img.url !== undefined && img.url !== ''
                                        ? img.url
                                        : __('Archivo #%d').replace('%d', String(img.image_file_id ?? 0))}
                                </span>
                                <button
                                    type="button"
                                    aria-label={__('Quitar imagen')}
                                    onClick={() => set({ images: images.filter((_, j) => j !== i) })}
                                    className="imcrm-text-[10px] imcrm-text-muted-foreground hover:imcrm-text-destructive"
                                >
                                    {__('Quitar')}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        className="imcrm-hidden"
                        onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void addUpload(f);
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
                        {__('Subir')}
                    </Button>
                    <Input
                        value={urlDraft}
                        onChange={(e) => setUrlDraft(e.target.value)}
                        placeholder={__('… o URL y Enter')}
                        className="imcrm-h-8 imcrm-flex-1"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                const v = urlDraft.trim();
                                if (v !== '') {
                                    set({ images: [...images, { url: v }] });
                                    setUrlDraft('');
                                }
                            }
                        }}
                    />
                </div>
            </div>

            <div className="imcrm-flex imcrm-gap-2">
                <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1.5">
                    <Label>{__('Columnas')}</Label>
                    <Select value={String(columns)} onChange={(e) => set({ columns: Number(e.target.value) })}>
                        <option value="2">2</option>
                        <option value="3">3</option>
                        <option value="4">4</option>
                    </Select>
                </div>
                <div className="imcrm-flex imcrm-flex-1 imcrm-flex-col imcrm-gap-1.5">
                    <Label>{__('Alto por celda (px)')}</Label>
                    <Input
                        type="number"
                        min={60}
                        max={480}
                        value={height}
                        onChange={(e) => {
                            const n = Number(e.target.value);
                            set({ height: Number.isFinite(n) ? Math.min(480, Math.max(60, Math.floor(n))) : 140 });
                        }}
                    />
                </div>
            </div>
        </div>
    );
}

/**
 * Render de la galería. `resolveSrc` decide el src de cada imagen:
 * en el admin usa la descarga con sesión; en el portal, la URL firmada
 * que inyectó el backend (viene ya en `img.url`).
 */
export function GalleryBlockView({
    config,
    resolveSrc,
}: {
    config: Record<string, unknown>;
    resolveSrc: (img: GalleryImage) => string | undefined;
}): JSX.Element {
    const images = readGalleryImages(config);
    const columns = typeof config.columns === 'number' ? Math.min(4, Math.max(2, config.columns)) : 3;
    const height = typeof config.height === 'number' && config.height > 0 ? config.height : 140;

    if (images.length === 0) {
        return (
            <div className="imcrm-flex imcrm-h-24 imcrm-items-center imcrm-justify-center imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-bg-muted/20 imcrm-text-xs imcrm-text-muted-foreground">
                {__('Añade imágenes a la galería')}
            </div>
        );
    }

    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: '8px',
            }}
        >
            {images.map((img, i) => {
                const src = resolveSrc(img);
                if (src === undefined) return null;
                return (
                    <img
                        key={i}
                        src={src}
                        alt={img.alt ?? ''}
                        loading="lazy"
                        style={{
                            width: '100%',
                            height: `${height}px`,
                            objectFit: 'cover',
                            display: 'block',
                            borderRadius: '8px',
                        }}
                    />
                );
            })}
        </div>
    );
}

/** Resuelve el src de una imagen de galería en superficies ADMIN. */
export function adminGallerySrc(img: GalleryImage): string | undefined {
    if (img.url !== undefined && img.url !== '') return img.url;
    return img.image_file_id !== undefined && img.image_file_id > 0
        ? `/api/v1/files/${img.image_file_id}/download`
        : undefined;
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
