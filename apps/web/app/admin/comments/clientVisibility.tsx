import { Eye } from 'lucide-react';

import { useList } from '@/hooks/useLists';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { CommentEntity } from '@/types/comment';

/**
 * Comentarios internos vs. visibles para el cliente del portal. Todo comentario
 * nace INTERNO: lo que el equipo habla entre sí jamás le llega al cliente por
 * accidente. El interruptor sólo aparece si la lista tiene el portal activo.
 */
export function useListPortalEnabled(listId: number | string | undefined): boolean {
    const list = useList(listId);
    const portal = (list.data?.settings as { portal?: { enabled?: unknown } } | undefined)?.portal;
    return portal?.enabled === true;
}

export function ClientVisibilityToggle({
    checked,
    onChange,
    disabled,
}: {
    checked: boolean;
    onChange: (next: boolean) => void;
    disabled?: boolean;
}): JSX.Element {
    return (
        <label
            className={cn(
                'imcrm-inline-flex imcrm-cursor-pointer imcrm-select-none imcrm-items-center imcrm-gap-1.5 imcrm-rounded-md imcrm-px-1.5 imcrm-py-1 imcrm-text-xs imcrm-transition-colors',
                checked ? 'imcrm-bg-amber-500/15 imcrm-font-medium imcrm-text-amber-900 dark:imcrm-text-amber-200' : 'imcrm-text-muted-foreground hover:imcrm-bg-accent/60',
            )}
            title={__('Si lo marcas, el cliente lo ve en su portal. Si no, sólo lo ve el equipo.')}
        >
            <input
                type="checkbox"
                className="imcrm-h-3.5 imcrm-w-3.5"
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                data-testid="comment-client-visible"
            />
            <Eye className="imcrm-h-3.5 imcrm-w-3.5" aria-hidden />
            {__('Visible para el cliente')}
        </label>
    );
}

/** Marca de un comentario que el cliente ve en su portal (o que escribió él). */
export function ClientVisibleBadge({ comment }: { comment: Pick<CommentEntity, 'visibility' | 'from_client'> }): JSX.Element | null {
    if (comment.visibility !== 'client') return null;
    return (
        <span
            className="imcrm-inline-flex imcrm-items-center imcrm-gap-1 imcrm-rounded imcrm-bg-amber-500/15 imcrm-px-1.5 imcrm-py-px imcrm-text-[11px] imcrm-font-medium imcrm-text-amber-900 dark:imcrm-text-amber-200"
            data-testid="comment-client-badge"
        >
            <Eye className="imcrm-h-3 imcrm-w-3" aria-hidden />
            {comment.from_client ? __('Del cliente') : __('Visible para el cliente')}
        </span>
    );
}
