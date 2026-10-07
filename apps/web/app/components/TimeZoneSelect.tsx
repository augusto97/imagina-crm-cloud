import { useMemo } from 'react';
import { COMMON_TIME_ZONES, timeZoneLabel } from '@imagina-base/shared';

import { cn } from '@/lib/utils';

/** Todas las zonas que conoce el navegador (las sugeridas van aparte, arriba). */
function allTimeZones(): string[] {
    try {
        const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
        if (typeof fn === 'function') return fn('timeZone');
    } catch {
        // Navegador viejo: queda sólo la lista sugerida.
    }
    return [];
}

/**
 * v0.1.263 — Selector de zona horaria: las zonas de los clientes de la app
 * arriba (con nombre legible) y todas las demás debajo. `emptyLabel` agrega
 * una opción vacía al principio (p. ej. «La de la empresa (Bogotá)»).
 */
export function TimeZoneSelect({
    id,
    value,
    onChange,
    emptyLabel,
    className,
    testId,
}: {
    id?: string;
    value: string | null;
    onChange: (tz: string | null) => void;
    emptyLabel?: string;
    className?: string;
    testId?: string;
}): JSX.Element {
    const others = useMemo(() => {
        const common = new Set(COMMON_TIME_ZONES.map((z) => z.tz));
        return allTimeZones().filter((tz) => !common.has(tz));
    }, []);
    const known = value === null || COMMON_TIME_ZONES.some((z) => z.tz === value) || others.includes(value);

    return (
        <select
            id={id}
            data-testid={testId}
            className={cn(
                'imcrm-h-9 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-text-sm',
                className,
            )}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
        >
            {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
            {!known && value && <option value={value}>{timeZoneLabel(value)}</option>}
            <optgroup label="Sugeridas">
                {COMMON_TIME_ZONES.map((z) => (
                    <option key={z.tz} value={z.tz}>
                        {z.label}
                    </option>
                ))}
            </optgroup>
            {others.length > 0 && (
                <optgroup label="Todas las zonas">
                    {others.map((tz) => (
                        <option key={tz} value={tz}>
                            {tz.replace(/_/g, ' ')}
                        </option>
                    ))}
                </optgroup>
            )}
        </select>
    );
}
