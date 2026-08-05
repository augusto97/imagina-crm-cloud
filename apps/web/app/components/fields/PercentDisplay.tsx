import { formatNumber } from '@/lib/tenantFormat';

/**
 * Porcentaje con barra de avance (v0.1.158). El valor es un número 0-100;
 * la barra es sólo lectura (se edita con el input numérico de la celda).
 * `config.show_bar: false` la apaga para quien prefiera la cifra sola.
 */
interface Props {
    value: unknown;
    config?: Record<string, unknown>;
}

export function PercentDisplay({ value, config }: Props): JSX.Element {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return <span className="imcrm-text-muted-foreground">—</span>;
    const precision = typeof config?.precision === 'number' ? config.precision : 0;
    const label = `${formatNumber(n, { maxFrac: precision })}%`;
    if (config?.show_bar === false) return <span>{label}</span>;

    const pct = Math.min(Math.max(n, 0), 100);
    return (
        <span className="imcrm-inline-flex imcrm-w-full imcrm-min-w-0 imcrm-items-center imcrm-gap-2">
            <span
                className="imcrm-h-1.5 imcrm-min-w-[36px] imcrm-flex-1 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted"
                aria-hidden
            >
                <span
                    className="imcrm-block imcrm-h-full imcrm-rounded-full imcrm-bg-primary"
                    style={{ width: `${pct}%` }}
                />
            </span>
            <span className="imcrm-shrink-0 imcrm-text-xs imcrm-tabular-nums imcrm-text-muted-foreground">
                {label}
            </span>
        </span>
    );
}
