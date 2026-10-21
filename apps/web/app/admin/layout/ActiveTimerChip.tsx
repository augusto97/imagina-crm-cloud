import { Link } from 'react-router';
import { Square } from 'lucide-react';
import { formatTimerClock } from '@imagina-base/shared';

import { useToast } from '@/components/ui/toast';
import { useNow } from '@/hooks/useNow';
import { runningSeconds, useActiveTimer, useStopTimer } from '@/hooks/useTimeTracking';
import { __, sprintf } from '@/lib/i18n';

/**
 * v0.1.288 — El cronómetro en curso, siempre a la vista en la barra superior:
 * cuánto lleva, en qué registro (click → la ficha) y el botón para detenerlo.
 * El estado vive en el servidor (sobrevive a recargar) y llega por realtime a
 * las demás pestañas: detenerlo en una lo saca de todas.
 */
export function ActiveTimerChip(): JSX.Element | null {
    const active = useActiveTimer();
    const stop = useStopTimer();
    const toast = useToast();
    const data = active.data ?? null;
    const now = useNow(data !== null);
    if (data === null) return null;
    const clock = formatTimerClock(runningSeconds(data.entry, now));
    return (
        <div
            className="imcrm-flex imcrm-h-8 imcrm-min-w-0 imcrm-items-center imcrm-rounded-full imcrm-border imcrm-border-primary/30 imcrm-bg-primary/10 imcrm-text-primary"
            data-testid="imcrm-active-timer"
        >
            <Link
                to={`/lists/${data.list_slug}/records/${data.entry.record_id}`}
                className="imcrm-flex imcrm-min-w-0 imcrm-items-center imcrm-gap-1.5 imcrm-rounded-l-full imcrm-py-1 imcrm-pl-2.5 imcrm-pr-1.5 hover:imcrm-bg-primary/10"
                title={sprintf(__('Cronómetro en curso: %1$s (%2$s)'), data.record_title, data.list_name)}
                aria-label={sprintf(__('Cronómetro en curso en «%1$s»: %2$s. Abrir el registro.'), data.record_title, clock)}
            >
                <span aria-hidden className="imcrm-h-2 imcrm-w-2 imcrm-shrink-0 imcrm-animate-pulse imcrm-rounded-full imcrm-bg-primary" />
                <span className="imcrm-font-mono imcrm-text-xs imcrm-font-semibold imcrm-tabular-nums" data-testid="imcrm-active-timer-clock">
                    {clock}
                </span>
                <span className="imcrm-hidden imcrm-max-w-[10rem] imcrm-truncate imcrm-text-xs imcrm-font-medium md:imcrm-inline">{data.record_title}</span>
            </Link>
            <button
                type="button"
                onClick={() =>
                    stop.mutate(undefined, {
                        onSuccess: () => toast.success(__('Cronómetro detenido'), __('El tiempo quedó registrado.')),
                        onError: (err) => toast.error(__('No se pudo detener el cronómetro'), err instanceof Error ? err.message : ''),
                    })
                }
                disabled={stop.isPending}
                className="imcrm-flex imcrm-h-full imcrm-items-center imcrm-rounded-r-full imcrm-border-l imcrm-border-primary/20 imcrm-px-2 hover:imcrm-bg-primary/15 disabled:imcrm-opacity-60"
                aria-label={__('Detener el cronómetro')}
                title={__('Detener el cronómetro')}
                data-testid="imcrm-active-timer-stop"
            >
                <Square className="imcrm-h-3 imcrm-w-3 imcrm-fill-current" />
            </button>
        </div>
    );
}
