import { useState } from 'react';
import { ExternalLink } from 'lucide-react';

import { proxiedImageUrl } from '@/lib/imageProxy';
import { cn } from '@/lib/utils';

/**
 * v0.1.210 — Un campo URL con `display: 'image'`: la miniatura (por el proxy
 * del API, ver `lib/imageProxy`) que abre la imagen completa al click. Si la
 * imagen no carga (no es una imagen, la tienda no responde) cae al enlace de
 * texto: nunca queda un hueco sin explicación.
 */
export function UrlImage({ value, size = 'cell' }: { value: unknown; size?: 'cell' | 'card' }): JSX.Element | null {
    const [failed, setFailed] = useState(false);
    if (typeof value !== 'string' || value.trim() === '') return null;
    const src = proxiedImageUrl(value);
    const href = /^https?:\/\//i.test(value) ? value : undefined;
    if (!src || failed) {
        return (
            <a
                href={href}
                target="_blank"
                rel="noreferrer"
                className="imcrm-inline-flex imcrm-max-w-full imcrm-items-center imcrm-gap-1 imcrm-text-primary hover:imcrm-underline"
                onClick={(e) => e.stopPropagation()}
            >
                <ExternalLink className="imcrm-h-3 imcrm-w-3 imcrm-shrink-0" aria-hidden />
                <span className="imcrm-truncate">{value.replace(/^https?:\/\//, '')}</span>
            </a>
        );
    }
    return (
        <a
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="imcrm-inline-flex imcrm-shrink-0"
            title={value}
        >
            <img
                src={src}
                alt=""
                decoding="async"
                onError={() => setFailed(true)}
                className={cn(
                    'imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-muted imcrm-object-cover',
                    size === 'cell' ? 'imcrm-h-7 imcrm-w-7' : 'imcrm-h-32 imcrm-w-32',
                )}
                data-testid="imcrm-url-image"
            />
        </a>
    );
}
