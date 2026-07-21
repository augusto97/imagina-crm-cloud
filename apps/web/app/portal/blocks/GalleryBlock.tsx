/**
 * v0.1.94 — Galería en grilla del portal. Las imágenes subidas llegan
 * con `url` FIRMADA inyectada por el backend; las externas, tal cual.
 * Imágenes sin URL se omiten.
 */
export function GalleryBlock({
    config,
}: {
    config: {
        images?: Array<{ url?: string; image_file_id?: number; alt?: string }>;
        columns?: number;
        height?: number;
    };
}): JSX.Element | null {
    const images = (config.images ?? []).filter(
        (i) => typeof i.url === 'string' && i.url !== '',
    );
    if (images.length === 0) return null;
    const columns = typeof config.columns === 'number' ? Math.min(4, Math.max(2, config.columns)) : 3;
    const height = typeof config.height === 'number' && config.height > 0 ? config.height : 140;
    return (
        <div
            style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gap: '8px',
            }}
        >
            {images.map((img, i) => (
                <img
                    key={i}
                    src={img.url}
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
            ))}
        </div>
    );
}
