import { CalendarRange } from 'lucide-react';

import { __ } from '@/lib/i18n';

import {
    DATE_RANGE_PRESETS,
    type DateRangePresetId,
} from './dateRangePresets';

interface DateRangePresetButtonsProps {
    /**
     * Llamado con el slug del preset (`this_month`, `last_30_days`, …).
     * El consumer crea UNA condición `between_relative` con ese slug
     * como `value` — es la lógica dinámica que se resuelve a fechas
     * en el momento de la query, no fechas fijas en el momento del
     * click.
     */
    onPick: (preset: DateRangePresetId) => void;
}

/**
 * Fila inline de presets ("Hoy", "Esta semana", "Este mes"…) que
 * aparece debajo de una row de filtro cuando el campo es
 * date/datetime. Cada botón crea/reemplaza el filtro por una sola
 * condición con operador `between_relative` y el slug del preset
 * como valor (ver `dateRangePresets.ts`).
 *
 * "Personalizado" no se muestra acá — el usuario edita los inputs
 * `desde`/`hasta` manualmente para rangos ad hoc.
 */
export function DateRangePresetButtons({
    onPick,
}: DateRangePresetButtonsProps): JSX.Element {
    const presets = DATE_RANGE_PRESETS.filter((p) => p.id !== 'custom');

    return (
        <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-1">
            <span className="imcrm-flex imcrm-items-center imcrm-gap-1 imcrm-text-[10px] imcrm-text-muted-foreground">
                <CalendarRange className="imcrm-h-3 imcrm-w-3" />
                {__('Rangos rápidos:')}
            </span>
            {presets.map((p) => (
                <button
                    key={p.id}
                    type="button"
                    onClick={() => onPick(p.id)}
                    className="imcrm-rounded imcrm-border imcrm-border-border imcrm-bg-card imcrm-px-1.5 imcrm-py-0.5 imcrm-text-[10px] hover:imcrm-bg-accent"
                >
                    {p.label}
                </button>
            ))}
        </div>
    );
}
