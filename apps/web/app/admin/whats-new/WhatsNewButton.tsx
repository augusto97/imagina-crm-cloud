import { Megaphone } from 'lucide-react';

import { useWhatsNewFeed } from '@/hooks/useWhatsNew';
import { __, sprintf } from '@/lib/i18n';
import { cn } from '@/lib/utils';

import { useWhatsNewPanel, whatsNewPanel } from './whatsNewStore';

/**
 * «Novedades» en la barra superior (megáfono, a la izquierda de la campana),
 * con el contador de lo que la persona todavía no vio. En el teléfono no hay
 * lugar: vive en el menú de la persona (y el avatar lleva un punto).
 */
export function WhatsNewButton({ className }: { className?: string }): JSX.Element {
    const feed = useWhatsNewFeed();
    const { open } = useWhatsNewPanel();
    const unseen = feed.data?.unseen_count ?? 0;
    return (
        <button
            type="button"
            onClick={() => (open ? whatsNewPanel.close() : whatsNewPanel.open())}
            aria-label={unseen > 0 ? sprintf(__('Novedades: %d sin ver'), unseen) : __('Novedades')}
            title={__('Novedades')}
            aria-haspopup="dialog"
            aria-expanded={open}
            data-tour="topbar-whats-new"
            data-testid="whats-new-button"
            className={cn(
                'imcrm-relative imcrm-flex imcrm-h-8 imcrm-w-8 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground imcrm-transition-colors hover:imcrm-bg-accent hover:imcrm-text-foreground focus-visible:imcrm-outline-none focus-visible:imcrm-ring-2 focus-visible:imcrm-ring-ring',
                open && 'imcrm-bg-accent imcrm-text-foreground',
                className,
            )}
        >
            <Megaphone className="imcrm-h-4 imcrm-w-4" aria-hidden />
            {unseen > 0 && (
                <span
                    aria-hidden
                    data-testid="whats-new-count"
                    className="imcrm-absolute imcrm--right-1 imcrm--top-1 imcrm-flex imcrm-h-4 imcrm-min-w-4 imcrm-items-center imcrm-justify-center imcrm-rounded-full imcrm-bg-primary imcrm-px-1 imcrm-text-[9px] imcrm-font-semibold imcrm-text-primary-foreground imcrm-ring-2 imcrm-ring-background"
                >
                    {unseen > 9 ? '9+' : unseen}
                </span>
            )}
        </button>
    );
}
