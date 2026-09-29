import type { CSSProperties } from 'react';

import { DEFAULT_FOLDER_ICON, listColor, listIcon, type ListIconComponent } from '@/lib/listIcons';
import { cn } from '@/lib/utils';

/**
 * Cuadrado de color con el icono, como en el menú lateral (v0.1.173): el
 * mismo dibujo para carpetas, listas y dashboards en el índice y en
 * Favoritos (v0.1.211). Sin color elegido, un gris neutro.
 */
export function IconSquare({
    icon: Icon,
    color,
    size = 'md',
    className,
}: {
    icon: ListIconComponent;
    color: string | undefined;
    size?: 'sm' | 'md' | 'lg';
    className?: string;
}): JSX.Element {
    const box = size === 'sm' ? 'imcrm-h-5 imcrm-w-5 imcrm-rounded-[5px]' : size === 'lg' ? 'imcrm-h-9 imcrm-w-9 imcrm-rounded-lg' : 'imcrm-h-7 imcrm-w-7 imcrm-rounded-md';
    const glyph = size === 'sm' ? 'imcrm-h-3 imcrm-w-3' : size === 'lg' ? 'imcrm-h-5 imcrm-w-5' : 'imcrm-h-4 imcrm-w-4';
    const style: CSSProperties | undefined = color !== undefined ? { backgroundColor: color } : undefined;
    return (
        <span
            aria-hidden
            className={cn(
                'imcrm-flex imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-text-white',
                box,
                color === undefined && 'imcrm-bg-muted-foreground/70',
                className,
            )}
            style={style}
        >
            <Icon className={glyph} />
        </span>
    );
}

/** El cuadrado de una carpeta (su icono y color, o la carpeta genérica). */
export function FolderSquare({
    group,
    size,
}: {
    group: { icon: string | null; color: string | null };
    size?: 'sm' | 'md' | 'lg';
}): JSX.Element {
    return <IconSquare icon={listIcon(group.icon) ?? DEFAULT_FOLDER_ICON} color={listColor(group.color)} size={size} />;
}
