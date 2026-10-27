import { useState } from 'react';

import { brandInitials } from '@/hooks/useAppIdentity';
import { cn } from '@/lib/utils';

/**
 * v0.1.327 — La marca en un cuadrado (riel, barra del celular): el logo de la
 * empresa o el ícono de la plataforma; sin imagen, las INICIALES del nombre.
 * Antes, sin logo, aparecía un ícono genérico que se leía como un logo que
 * nadie había elegido.
 */
export function BrandMark({
    url,
    name,
    className,
    tone = 'plain',
}: {
    url: string | null;
    name: string;
    className?: string;
    /** `rail`: sobre el riel del menú (sus colores); `plain`: sobre la app. */
    tone?: 'rail' | 'plain';
}): JSX.Element {
    const [broken, setBroken] = useState<string | null>(null);
    if (url && broken !== url) {
        return (
            <img
                src={url}
                alt=""
                onError={() => setBroken(url)}
                className={cn('imcrm-shrink-0 imcrm-rounded-md imcrm-object-contain', className)}
            />
        );
    }
    return (
        <span
            aria-hidden
            className={cn(
                'imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-[12px] imcrm-font-semibold imcrm-tracking-tight',
                tone === 'rail'
                    ? 'imcrm-bg-sidebar-foreground/15 imcrm-text-sidebar-accent-foreground imcrm-ring-1 imcrm-ring-sidebar-foreground/20'
                    : 'imcrm-bg-foreground imcrm-text-background',
                className,
            )}
        >
            {brandInitials(name)}
        </span>
    );
}
