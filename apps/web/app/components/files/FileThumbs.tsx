import { useState } from 'react';
import { Paperclip } from 'lucide-react';

import { isPlainClick, openAttachmentsPreview } from '@/components/files/openAttachments';
import { useAttachmentList, type ResolvedAttachment } from '@/hooks/useAttachments';
import { thumbSources, visibleFileItems } from '@/lib/fileThumbs';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * v0.1.426 — Los archivos de un campo como se ven en la tabla, la ficha, las
 * tarjetas y el portal: las IMÁGENES como miniatura (pedida al servidor ya
 * achicada, nunca el original de 4 MB) y el resto con su ícono y su nombre.
 *
 * Un click abre el visor de adjuntos con todos los del campo (←/→); Ctrl/⌘+click
 * abre el archivo en otra pestaña. El click no llega a la fila: en la tabla no
 * abre el registro.
 *
 * - `cell`: una línea, alto de la fila (la densidad de la tabla lo ajusta por
 *   CSS: `.imcrm-file-thumb`), hasta 4 y «+N».
 * - `field`: la ficha y el portal, miniaturas más grandes que bajan de línea.
 */
interface FileThumbStripProps {
    ids: readonly number[];
    size?: 'cell' | 'field';
}

/** Cuántos archivos de un campo se resuelven (el resto sólo suma al «+N»). */
const RESOLVE_MAX = { cell: 6, field: 24 } as const;
const SHOW_MAX = { cell: 4, field: 12 } as const;

export function FileThumbStrip({ ids, size = 'cell' }: FileThumbStripProps): JSX.Element {
    const items = useAttachmentList(ids.slice(0, RESOLVE_MAX[size]));
    const loadingAll = items.every((it) => it.isLoading);
    if (items.length > 0 && !loadingAll && items.every((it) => !it.isLoading && !it.data)) {
        return <span className="imcrm-text-muted-foreground">{__('Archivo no disponible')}</span>;
    }
    const known = items.filter((it) => it.isLoading || it.data);
    const { shown } = visibleFileItems(known, (it) => (it.data ? it.data.thumbUrl !== undefined : null), SHOW_MAX[size], {
        stopAfterNamed: size === 'cell',
    });
    const more = ids.length - shown.length;
    const open = (e: React.MouseEvent, id: number): void => {
        e.stopPropagation();
        // Un click abre el visor (con los demás del campo para pasar con ←/→);
        // Ctrl/⌘+click, otra pestaña.
        if (!isPlainClick(e)) return;
        e.preventDefault();
        void openAttachmentsPreview(ids, id);
    };
    const cell = size === 'cell';
    return (
        <span
            className={cn(
                'imcrm-inline-flex imcrm-min-w-0 imcrm-max-w-full imcrm-items-center',
                cell ? 'imcrm-flex-nowrap imcrm-gap-1 imcrm-overflow-hidden' : 'imcrm-flex-wrap imcrm-gap-1.5',
            )}
            data-testid="imcrm-file-strip"
        >
            {shown.map((it) =>
                it.data ? (
                    it.data.thumbUrl !== undefined ? (
                        <ThumbLink key={it.id} file={it.data} size={size} onOpen={open} />
                    ) : (
                        <NameLink key={it.id} file={it.data} size={size} onOpen={open} />
                    )
                ) : (
                    <span
                        key={it.id}
                        aria-hidden
                        className={cn('imcrm-shrink-0 imcrm-animate-pulse imcrm-rounded imcrm-bg-muted', cell ? 'imcrm-file-thumb' : 'imcrm-h-16 imcrm-w-16')}
                    />
                ),
            )}
            {more > 0 && (
                <span className="imcrm-shrink-0 imcrm-text-xs imcrm-tabular-nums imcrm-text-muted-foreground">+{more}</span>
            )}
        </span>
    );
}

function ThumbLink({
    file,
    size,
    onOpen,
}: {
    file: ResolvedAttachment;
    size: 'cell' | 'field';
    onOpen: (e: React.MouseEvent, id: number) => void;
}): JSX.Element {
    const [failed, setFailed] = useState(false);
    if (failed) return <NameLink file={file} size={size} onOpen={onOpen} />;
    const cell = size === 'cell';
    const sources = cell ? thumbSources(file.thumbUrl!, 96, 160) : thumbSources(file.thumbUrl!, 160, 320);
    return (
        <a
            href={file.url}
            target="_blank"
            rel="noreferrer"
            title={file.title}
            aria-label={file.title}
            className="imcrm-inline-flex imcrm-shrink-0 imcrm-rounded focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-primary/50"
            data-testid="imcrm-file-link"
            onClick={(e) => onOpen(e, file.id)}
        >
            <img
                src={sources.src}
                srcSet={sources.srcSet}
                alt={file.title}
                decoding="async"
                draggable={false}
                onError={() => setFailed(true)}
                className={cn(
                    'imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-muted imcrm-object-cover',
                    cell ? 'imcrm-file-thumb' : 'imcrm-h-16 imcrm-w-16 hover:imcrm-opacity-90',
                )}
                data-testid="imcrm-file-thumb"
            />
        </a>
    );
}

function NameLink({
    file,
    size,
    onOpen,
}: {
    file: ResolvedAttachment;
    size: 'cell' | 'field';
    onOpen: (e: React.MouseEvent, id: number) => void;
}): JSX.Element {
    return (
        <span
            className={cn(
                'imcrm-inline-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5',
                size === 'field' && 'imcrm-max-w-full imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-background imcrm-px-2 imcrm-py-1',
            )}
        >
            <Paperclip className="imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0 imcrm-text-muted-foreground" aria-hidden />
            <a
                href={file.url}
                target="_blank"
                rel="noreferrer"
                className="imcrm-truncate imcrm-text-primary hover:imcrm-underline"
                title={file.title}
                data-testid="imcrm-file-link"
                onClick={(e) => onOpen(e, file.id)}
            >
                {file.title}
            </a>
        </span>
    );
}
