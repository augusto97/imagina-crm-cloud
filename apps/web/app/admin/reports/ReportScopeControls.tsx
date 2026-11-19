import { DATE_RANGE_PRESETS } from '@/admin/records/dateRangePresets';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import { cn } from '@/lib/utils';

const CUSTOM_RE = /^custom:(\d{4}-\d{2}-\d{2}):(\d{4}-\d{2}-\d{2})$/;

/**
 * v0.1.464 (J1) — El período y la comparación de un informe (la página y los
 * ajustes del editor). `''` = lo de cada bloque. Un rango propio viaja como
 * `custom:AAAA-MM-DD:AAAA-MM-DD`, igual que en los tableros.
 */
export function ReportScopeControls({
    period,
    compare,
    onPeriod,
    onCompare,
    compact = false,
    idPrefix,
}: {
    period: string;
    compare: string;
    onPeriod: (v: string) => void;
    onCompare: (v: string) => void;
    compact?: boolean;
    idPrefix: string;
}): JSX.Element {
    const custom = CUSTOM_RE.exec(period);
    const isCustom = custom !== null || period === 'custom';
    const from = custom?.[1] ?? '';
    const to = custom?.[2] ?? '';
    const setRange = (a: string, b: string): void => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b)) onPeriod(`custom:${a}:${b}`);
        else onPeriod('custom');
    };
    const h = compact ? 'imcrm-h-8 imcrm-text-[13px]' : 'imcrm-h-9 imcrm-text-sm';
    return (
        <div className={cn('imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2', !compact && 'imcrm-flex-col imcrm-items-stretch')}>
            <Select
                id={`${idPrefix}-period`}
                value={isCustom ? 'custom' : period}
                onChange={(e) => onPeriod(e.target.value === 'custom' ? 'custom' : e.target.value)}
                className={cn(h, compact && 'imcrm-w-auto')}
                aria-label={__('Período del informe')}
                data-testid="report-period"
            >
                <option value="">{__('Cada bloque con su período')}</option>
                {DATE_RANGE_PRESETS.filter((p) => p.id !== 'custom').map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                ))}
                <option value="custom">{__('Personalizado…')}</option>
            </Select>
            {isCustom && (
                <span className="imcrm-flex imcrm-items-center imcrm-gap-1">
                    <input
                        type="date"
                        value={from}
                        onChange={(e) => setRange(e.target.value, to)}
                        aria-label={__('Desde')}
                        className={cn('imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2', h)}
                    />
                    <span className="imcrm-text-xs imcrm-text-muted-foreground">→</span>
                    <input
                        type="date"
                        value={to}
                        onChange={(e) => setRange(from, e.target.value)}
                        aria-label={__('Hasta')}
                        className={cn('imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-2', h)}
                    />
                </span>
            )}
            <Select
                id={`${idPrefix}-compare`}
                value={compare}
                onChange={(e) => onCompare(e.target.value)}
                className={cn(h, compact && 'imcrm-w-auto')}
                aria-label={__('Comparar con')}
                data-testid="report-compare"
            >
                <option value="">{__('Comparar: lo de cada bloque')}</option>
                <option value="previous">{__('Comparar con el período anterior')}</option>
                <option value="last_year">{__('Comparar con el año pasado')}</option>
                <option value="none">{__('No comparar')}</option>
            </Select>
        </div>
    );
}

/** El período que se puede mandar al servidor (un «Personalizado» sin fechas todavía no cuenta). */
export function sendablePeriod(period: string): string {
    return period === 'custom' ? '' : period;
}
