import { forwardRef, useEffect, useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { EMBED_PROVIDER_LABELS, whatsNewVideo, type WhatsNewAction, type WhatsNewKind, type WhatsNewMedia } from '@imagina-base/shared';

import { Badge } from '@/components/ui/badge';
import { __ } from '@/lib/i18n';
import { parseUtcDate } from '@/lib/utcDate';
import { cn } from '@/lib/utils';

import { WhatsNewActionButton } from './WhatsNewActionButton';
import { dayLabel, kindLabel, WHATS_NEW_KIND_META } from './whatsNewMeta';
import { WhatsNewRichText } from './WhatsNewRichText';
import { WhatsNewVisualSlot } from './WhatsNewVisualSlot';

/** Lo que hace falta para dibujar una novedad (la de la persona o la vista previa del operador). */
export interface WhatsNewCardItem {
    id: number;
    kind: WhatsNewKind;
    title: string;
    summary: string;
    body: string;
    image_url: string | null;
    video_url: string | null;
    /** Ilustración animada, captura real o carrusel (v0.1.325). */
    media?: WhatsNewMedia | null;
    action: WhatsNewAction | null;
    published_at: string | null;
    is_new?: boolean;
}

/** Chip del tipo, con su color legible en claro y en oscuro. */
export function WhatsNewKindChip({ kind, className }: { kind: WhatsNewKind; className?: string }): JSX.Element {
    const meta = WHATS_NEW_KIND_META[kind];
    const Icon = meta.icon;
    return (
        <Badge variant={meta.tone} className={cn('imcrm-gap-1 imcrm-text-[11px]', className)} data-whats-new-kind={kind}>
            <Icon className="imcrm-h-3 imcrm-w-3" aria-hidden />
            {kindLabel(kind)}
        </Badge>
    );
}

/** Imagen de la novedad (capturas, ilustraciones). Sin `loading="lazy"`: dentro de un panel con scroll propio no dispara. */
export function WhatsNewImage({ src, className }: { src: string; className?: string }): JSX.Element {
    return (
        <img
            src={src}
            alt=""
            decoding="async"
            referrerPolicy="no-referrer"
            className={cn('imcrm-block imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-object-cover', className)}
        />
    );
}

/** Video de YouTube, Vimeo o Loom (lo único que acepta la CSP del iframe). */
export function WhatsNewVideo({ url, title }: { url: string; title: string }): JSX.Element | null {
    const v = whatsNewVideo(url);
    if (!v) return null;
    return (
        <div className="imcrm-overflow-hidden imcrm-rounded-md imcrm-border imcrm-border-border">
            <div className="imcrm-relative imcrm-w-full" style={{ paddingTop: `${Math.round(v.ratio * 100)}%` }}>
                <iframe
                    src={v.src}
                    title={`${title} — ${EMBED_PROVIDER_LABELS[v.provider]}`}
                    allow="accelerometer; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
                    referrerPolicy="strict-origin-when-cross-origin"
                    className="imcrm-absolute imcrm-inset-0 imcrm-h-full imcrm-w-full"
                    style={{ border: 0 }}
                />
            </div>
        </div>
    );
}

interface WhatsNewCardProps {
    item: WhatsNewCardItem;
    /** Pinta la marca «Nuevo» (el panel la conserva mientras está abierto, aunque ya se marcó vista). */
    highlightNew?: boolean;
    defaultExpanded?: boolean;
    /** La primera vez que la persona abre el detalle. */
    onOpened?: () => void;
    /** Al tocar el botón de la novedad. */
    onAction?: () => void;
    className?: string;
}

/**
 * Una novedad: tipo, fecha, título, resumen, imagen y —en «Ver más»— el
 * cuerpo y el video, con su botón. La misma pieza en el panel, en la página
 * de historial y en la vista previa del operador (lo que se ve al escribir es
 * lo que verá la persona).
 */
export const WhatsNewCard = forwardRef<HTMLElement, WhatsNewCardProps>(function WhatsNewCard(
    { item, highlightNew, defaultExpanded = false, onOpened, onAction, className },
    ref,
) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const [opened, setOpened] = useState(defaultExpanded);
    const detailId = useId();
    const hasDetail = item.body.trim() !== '' || (item.video_url !== null && whatsNewVideo(item.video_url) !== null);
    const date = item.published_at ? parseUtcDate(item.published_at) : null;
    const isNew = highlightNew ?? item.is_new ?? false;

    // Abierta directamente en esta novedad (`openWhatsNew({ id })`): cuenta como abierta.
    useEffect(() => {
        if (defaultExpanded && hasDetail) onOpened?.();
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo al montar
    }, []);

    const toggle = (): void => {
        const next = !expanded;
        setExpanded(next);
        if (next && !opened) {
            setOpened(true);
            onOpened?.();
        }
    };

    return (
        <article
            ref={ref}
            data-whats-new={item.id}
            data-new={isNew ? '' : undefined}
            aria-labelledby={`${detailId}-title`}
            className={cn(
                'imcrm-flex imcrm-flex-col imcrm-gap-2.5 imcrm-rounded-lg imcrm-border imcrm-bg-card imcrm-p-4 imcrm-text-card-foreground',
                isNew ? 'imcrm-border-primary/40 imcrm-shadow-imcrm-sm' : 'imcrm-border-border',
                className,
            )}
        >
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                <WhatsNewKindChip kind={item.kind} />
                {isNew && (
                    <span className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-text-[11px] imcrm-font-semibold imcrm-text-primary" data-testid="whats-new-new-mark">
                        <span aria-hidden className="imcrm-h-1.5 imcrm-w-1.5 imcrm-rounded-full imcrm-bg-primary" />
                        {__('Nuevo')}
                    </span>
                )}
                {date && !Number.isNaN(date.getTime()) && (
                    <time dateTime={date.toISOString()} className="imcrm-ml-auto imcrm-text-[11px] imcrm-text-muted-foreground">
                        {dayLabel(date)}
                    </time>
                )}
            </div>
            <h3 id={`${detailId}-title`} className="imcrm-text-[15px] imcrm-font-semibold imcrm-leading-snug imcrm-tracking-tight">
                {item.title}
            </h3>
            <p className="imcrm-text-[13px] imcrm-leading-relaxed imcrm-text-muted-foreground">{item.summary}</p>
            <WhatsNewVisualSlot item={item} variant="card" />
            {expanded && hasDetail && (
                <div id={detailId} className="imcrm-flex imcrm-flex-col imcrm-gap-3 imcrm-pt-1">
                    <WhatsNewRichText text={item.body} />
                    {item.video_url && <WhatsNewVideo url={item.video_url} title={item.title} />}
                </div>
            )}
            {(hasDetail || item.action) && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-pt-0.5">
                    <WhatsNewActionButton action={item.action} onActivate={onAction} />
                    {hasDetail && (
                        <button
                            type="button"
                            onClick={toggle}
                            aria-expanded={expanded}
                            aria-controls={expanded ? detailId : undefined}
                            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded-md imcrm-px-2 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring"
                            data-testid="whats-new-more"
                        >
                            {expanded ? __('Ver menos') : __('Ver más')}
                            <ChevronDown className={cn('imcrm-h-3.5 imcrm-w-3.5 motion-safe:imcrm-transition-transform', expanded && 'imcrm-rotate-180')} aria-hidden />
                        </button>
                    )}
                </div>
            )}
        </article>
    );
});
