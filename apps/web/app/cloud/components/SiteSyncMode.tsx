import { Clock, Zap } from 'lucide-react';
import { SITE_SYNC_INTERVALS, type SiteSyncMode } from '@imagina-base/shared';

import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/**
 * Cómo se mantiene al día un sitio WordPress (v0.1.334, ADR-S84): «Al
 * instante» (el complemento avisa cada cambio y una vez por hora se revisa
 * todo, por si algo se perdió) o «Cada cierto tiempo». Al instante necesita el
 * complemento y un usuario administrador del sitio; sin eso la opción se ve
 * con el motivo.
 */

export const SITE_INTERVAL_LABEL: Record<number, string> = {
    5: 'Cada 5 minutos',
    15: 'Cada 15 minutos',
    30: 'Cada 30 minutos',
    60: 'Cada hora',
    180: 'Cada 3 horas',
    360: 'Cada 6 horas',
    1440: 'Una vez por día',
};

export function siteIntervalLabel(n: number): string {
    return __(SITE_INTERVAL_LABEL[n] ?? `Cada ${n} minutos`);
}

export function SiteSyncModeChoice({
    mode,
    interval,
    onMode,
    onInterval,
    realtimeBlocked,
    disabled,
    idPrefix,
}: {
    mode: SiteSyncMode;
    interval: number;
    onMode: (m: SiteSyncMode) => void;
    onInterval: (n: number) => void;
    /** Por qué no se puede elegir «Al instante» (null = se puede). */
    realtimeBlocked: string | null;
    disabled?: boolean;
    idPrefix: string;
}): JSX.Element {
    const card = (on: boolean, blocked: boolean) =>
        cn(
            'imcrm-flex imcrm-items-start imcrm-gap-2.5 imcrm-rounded-md imcrm-border imcrm-p-3 imcrm-text-sm imcrm-transition-colors',
            on ? 'imcrm-border-primary imcrm-bg-primary/5' : 'imcrm-border-border',
            blocked ? 'imcrm-cursor-not-allowed imcrm-opacity-70' : 'imcrm-cursor-pointer hover:imcrm-bg-muted/40',
        );
    return (
        <div className="imcrm-grid imcrm-gap-2 sm:imcrm-grid-cols-2" role="radiogroup" aria-label={__('Cómo se mantiene al día')} data-tour="site-sync-mode">
            <label className={card(mode === 'realtime', realtimeBlocked !== null)} data-testid={`${idPrefix}-mode-realtime`}>
                <input
                    type="radio"
                    name={`${idPrefix}-mode`}
                    className="imcrm-mt-0.5"
                    checked={mode === 'realtime'}
                    disabled={disabled || realtimeBlocked !== null}
                    onChange={() => onMode('realtime')}
                />
                <span className="imcrm-min-w-0">
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium">
                        <Zap className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-primary" aria-hidden />
                        {__('Al instante')}
                        {realtimeBlocked === null && <span className="imcrm-text-[11px] imcrm-font-normal imcrm-text-muted-foreground">· {__('recomendado')}</span>}
                    </span>
                    <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Cada cambio que hagas en WordPress llega en segundos. Además, una vez por hora se revisa todo, por si algo se perdió.')}
                    </span>
                    {realtimeBlocked && (
                        <span className="imcrm-mt-1 imcrm-block imcrm-text-xs imcrm-text-warning" data-testid={`${idPrefix}-mode-blocked`}>
                            {realtimeBlocked}
                        </span>
                    )}
                </span>
            </label>
            <label className={card(mode === 'interval', false)} data-testid={`${idPrefix}-mode-interval`}>
                <input type="radio" name={`${idPrefix}-mode`} className="imcrm-mt-0.5" checked={mode === 'interval'} disabled={disabled} onChange={() => onMode('interval')} />
                <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-space-y-1.5">
                    <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5 imcrm-font-medium">
                        <Clock className="imcrm-h-3.5 imcrm-w-3.5 imcrm-text-muted-foreground" aria-hidden />
                        {__('Cada cierto tiempo')}
                    </span>
                    <span className="imcrm-block imcrm-text-xs imcrm-text-muted-foreground">{__('La app revisa el sitio con la frecuencia que elijas. Y cuando quieras, con «Sincronizar ahora».')}</span>
                    {mode === 'interval' && (
                        <Select
                            id={`${idPrefix}-interval`}
                            aria-label={__('Frecuencia')}
                            className="imcrm-w-full sm:imcrm-w-56"
                            value={String(interval)}
                            disabled={disabled}
                            onChange={(e) => onInterval(Number(e.target.value))}
                            data-testid={`${idPrefix}-interval`}
                        >
                            {SITE_SYNC_INTERVALS.map((n) => (
                                <option key={n} value={n}>
                                    {siteIntervalLabel(n)}
                                </option>
                            ))}
                        </Select>
                    )}
                </span>
            </label>
        </div>
    );
}
