/**
 * Bloque IMAGEN del portal del cliente (v0.1.93).
 *
 * Renderiza `config.url` — para imágenes subidas al módulo de archivos
 * el backend la inyecta como URL FIRMADA en `portal.me` (el rol client
 * no tiene la descarga con sesión de miembro). Sin URL, no renderiza
 * nada (el admin ve el placeholder en el editor, el cliente no ve un
 * hueco roto).
 */
export function ImageBlock({
    config,
}: {
    config: {
        url?: string;
        alt?: string;
        height?: number;
        fit?: 'cover' | 'contain';
        link_url?: string;
    };
}): JSX.Element | null {
    const src = typeof config.url === 'string' && config.url !== '' ? config.url : undefined;
    if (src === undefined) return null;

    const height =
        typeof config.height === 'number' && config.height > 0 ? config.height : undefined;
    const img = (
        <img
            src={src}
            alt={config.alt ?? ''}
            loading="lazy"
            style={{
                width: '100%',
                height: height !== undefined ? `${height}px` : 'auto',
                objectFit: config.fit === 'contain' ? 'contain' : 'cover',
                display: 'block',
                borderRadius: 'inherit',
            }}
        />
    );

    if (typeof config.link_url === 'string' && config.link_url !== '') {
        return (
            <a
                href={config.link_url}
                target="_blank"
                rel="noreferrer noopener"
                style={{ display: 'block' }}
            >
                {img}
            </a>
        );
    }
    return img;
}
