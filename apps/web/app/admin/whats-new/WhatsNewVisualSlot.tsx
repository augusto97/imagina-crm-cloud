import { lazy, Suspense } from 'react';
import { whatsNewHasVisual, type WhatsNewMedia } from '@imagina-base/shared';

import { cn } from '@/lib/utils';

import type { WhatsNewVisualVariant } from './WhatsNewVisual';

const WhatsNewVisual = lazy(() => import('./WhatsNewVisual'));

/**
 * Dónde va lo visual de una novedad. El componente (ilustraciones, capturas,
 * carrusel) se baja recién cuando una novedad trae algo para mostrar: el panel
 * vive en el shell y no debe engordar la carga inicial.
 */
export function WhatsNewVisualSlot({
    item,
    variant,
    className,
}: {
    item: { image_url: string | null; video_url?: string | null; media?: WhatsNewMedia | null; title: string };
    variant: WhatsNewVisualVariant;
    className?: string;
}): JSX.Element | null {
    const media = item.media ?? null;
    if (!whatsNewHasVisual({ image_url: item.image_url, video_url: null, media: media ?? { illustration: null, demo: null, slides: [] } })) return null;
    return (
        <div className={cn('imcrm-min-w-0', className)} data-testid="whats-new-visual">
            <Suspense
                fallback={
                    <div
                        className={cn('imcrm-w-full imcrm-animate-pulse imcrm-bg-muted/40', variant === 'card' && 'imcrm-rounded-lg')}
                        style={{ aspectRatio: '480 / 300' }}
                    />
                }
            >
                <WhatsNewVisual imageUrl={item.image_url} media={media} variant={variant} title={item.title} />
            </Suspense>
        </div>
    );
}
