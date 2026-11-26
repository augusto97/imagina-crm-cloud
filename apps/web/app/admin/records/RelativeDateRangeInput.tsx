import { FALLBACK_TIME_ZONE, ROLLING_DATE_MAX_DAYS, ROLLING_DATE_MIN_DAYS, type DateClock } from '@imagina-base/shared';
import { useEffect, useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { __ } from '@/lib/i18n';
import { formatDateStr, getTenantTimeZone } from '@/lib/tenantFormat';

import {
    FIXED_RELATIVE_PRESETS,
    ROLLING_DATE_OPTIONS,
    customRangeOf,
    parseDaysInput,
    relativeDateKeyOf,
    relativeDatePreview,
    rollingDaysOf,
    valueForRelativeKey,
    type RelativeDateKey,
} from './relativeDateValue';

interface RelativeDateRangeInputProps {
    value: unknown;
    onChange: (v: unknown) => void;
    /** Sólo para pruebas: «hoy» y la zona (por defecto, ahora en la zona de la empresa). */
    clock?: DateClock;
    'aria-label'?: string;
}

/**
 * v0.1.469 — El lado «valor» de «es en…» para una fecha o fecha y hora: los
 * rangos fijos («Este mes», «Próximos 7 días»), CUALQUIER cantidad de días
 * («Próximos N días…», «Últimos N días…», «Hace más de N días…», «Dentro de
 * más de N días…») y «Personalizado…» (dos fechas). Debajo, qué abarca hoy en
 * el formato de fecha y la zona de la empresa, para que no haya que hacer la
 * cuenta de cabeza. Lo usan los filtros de la tabla, los colores, las
 * condiciones de las automatizaciones, el filtro de ítems de los PDF y los
 * widgets.
 */
export function RelativeDateRangeInput({ value, onChange, clock: fixedClock, 'aria-label': ariaLabel }: RelativeDateRangeInputProps): JSX.Element {
    const clock = useMemo<DateClock>(
        () => fixedClock ?? { now: new Date(), timeZone: getTenantTimeZone() ?? FALLBACK_TIME_ZONE },
        [fixedClock],
    );
    const key = relativeDateKeyOf(value);
    const rollingDir = key.startsWith('rolling:') ? key.slice('rolling:'.length) : null;
    const rollingOption = ROLLING_DATE_OPTIONS.find((o) => o.dir === rollingDir) ?? null;
    const custom = key === 'custom' ? customRangeOf(value) : null;

    // El número se edita como texto: mientras está vacío o fuera de rango no se
    // guarda nada (el filtro sigue con el último valor que servía).
    const savedDays = rollingDaysOf(value);
    const [draft, setDraft] = useState<string>(savedDays !== null ? String(savedDays) : '');
    useEffect(() => {
        if (savedDays !== null && parseDaysInput(draft) !== savedDays) setDraft(String(savedDays));
        // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo cuando cambia el valor guardado
    }, [savedDays]);
    const draftInvalid = rollingOption !== null && parseDaysInput(draft) === null;

    const preview = relativeDatePreview(value, clock, (ymd) => formatDateStr(ymd));

    const onSelect = (next: RelativeDateKey): void => {
        const v = valueForRelativeKey(next, value, clock);
        const days = rollingDaysOf(v);
        if (days !== null) setDraft(String(days));
        onChange(v);
    };

    return (
        <div className="imcrm-flex imcrm-min-w-0 imcrm-flex-col imcrm-gap-1.5" data-testid="imcrm-relative-date">
            <Select
                value={key}
                aria-label={ariaLabel ?? __('Rango de fechas')}
                data-testid="imcrm-relative-date-select"
                onChange={(e) => onSelect(e.target.value as RelativeDateKey)}
            >
                <optgroup label={__('Rangos fijos')}>
                    {FIXED_RELATIVE_PRESETS.map((p) => (
                        <option key={p.id} value={p.id}>
                            {p.label}
                        </option>
                    ))}
                </optgroup>
                <optgroup label={__('Cualquier cantidad de días')}>
                    {ROLLING_DATE_OPTIONS.map((o) => (
                        <option key={o.dir} value={`rolling:${o.dir}`}>
                            {o.label}
                        </option>
                    ))}
                </optgroup>
                <option value="custom">{__('Personalizado…')}</option>
            </Select>

            {rollingOption && (
                <label className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-foreground">
                    <span>{rollingOption.prefix}</span>
                    <Input
                        type="number"
                        inputMode="numeric"
                        min={ROLLING_DATE_MIN_DAYS}
                        max={ROLLING_DATE_MAX_DAYS}
                        step={1}
                        value={draft}
                        aria-label={__('Cantidad de días')}
                        aria-invalid={draftInvalid || undefined}
                        data-testid="imcrm-relative-date-days"
                        className="imcrm-h-8 imcrm-w-20"
                        onChange={(e) => {
                            const text = e.target.value;
                            setDraft(text);
                            const days = parseDaysInput(text);
                            if (days !== null && rollingOption) onChange({ days, dir: rollingOption.dir });
                        }}
                        onBlur={() => {
                            if (parseDaysInput(draft) === null && savedDays !== null) setDraft(String(savedDays));
                        }}
                    />
                    <span>{__('días')}</span>
                </label>
            )}
            {draftInvalid && (
                <span className="imcrm-text-xs imcrm-text-destructive" role="alert">
                    {__('Escribe un número entero de 1 a 3650.')}
                </span>
            )}

            {custom && (
                <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                    <span className="imcrm-text-muted-foreground">{__('Del')}</span>
                    <Input
                        type="date"
                        value={custom.from}
                        aria-label={__('Desde')}
                        data-testid="imcrm-relative-date-from"
                        className="imcrm-h-8 imcrm-w-auto"
                        onChange={(e) => {
                            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) onChange({ from: e.target.value, to: custom.to });
                        }}
                    />
                    <span className="imcrm-text-muted-foreground">{__('al')}</span>
                    <Input
                        type="date"
                        value={custom.to}
                        aria-label={__('Hasta')}
                        data-testid="imcrm-relative-date-to"
                        className="imcrm-h-8 imcrm-w-auto"
                        onChange={(e) => {
                            if (/^\d{4}-\d{2}-\d{2}$/.test(e.target.value)) onChange({ from: custom.from, to: e.target.value });
                        }}
                    />
                </div>
            )}

            {preview && (
                <span className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="imcrm-relative-date-preview">
                    {preview}
                </span>
            )}
        </div>
    );
}
