import { Plus, X } from 'lucide-react';
import type { BookingInterval } from '@imagina-base/shared';

import { Input } from '@/components/ui/input';
import { __ } from '@/lib/i18n';

import { dayProblem, nextInterval } from './bookingDesignOps';

/**
 * El horario de una semana (tramos por día): el de quien atiende en la agenda,
 * el propio de un servicio, el del widget de contacto y (v0.1.467) el horario
 * laboral de la empresa. Vive aparte para que Ajustes no cargue la agenda.
 */

const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;
const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

export function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }): JSX.Element {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={onClick}
            className="imcrm-inline-flex imcrm-h-8 imcrm-w-8 imcrm-shrink-0 imcrm-items-center imcrm-justify-center imcrm-rounded-md imcrm-text-muted-foreground hover:imcrm-bg-accent hover:imcrm-text-foreground disabled:imcrm-pointer-events-none disabled:imcrm-opacity-40"
        >
            {children}
        </button>
    );
}

export function WeekHoursEditor({
    week,
    onDay,
    onCopyWeekdays,
    testId,
    readOnly,
    emptyLabel,
}: {
    week: BookingInterval[][];
    onDay: (dow: number, intervals: BookingInterval[]) => void;
    onCopyWeekdays?: (dow: number) => void;
    testId?: string;
    /** Sólo mirar (p. ej. quien no es admin en Ajustes → Horario laboral). */
    readOnly?: boolean;
    /** Lo que dice un día sin tramos (de fábrica «No atiende»). */
    emptyLabel?: string;
}): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border" data-testid={testId}>
            {WEEK_ORDER.map((dow) => {
                const day = week[dow] ?? [];
                const problem = dayProblem(day);
                return (
                    <div key={dow} className="imcrm-flex imcrm-flex-col imcrm-gap-1.5 imcrm-px-3 imcrm-py-2" data-day={dow}>
                        <div className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <label className="imcrm-flex imcrm-w-28 imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                                <input
                                    type="checkbox"
                                    checked={day.length > 0}
                                    disabled={readOnly}
                                    onChange={(e) => onDay(dow, e.target.checked ? [{ start: '08:00', end: '17:00' }] : [])}
                                    data-day-toggle={dow}
                                />
                                {__(DAY_NAMES[dow]!)}
                            </label>
                            {day.length === 0 && <span className="imcrm-text-xs imcrm-text-muted-foreground">{emptyLabel ?? __('No atiende')}</span>}
                            {!readOnly && onCopyWeekdays && day.length > 0 && dow >= 1 && dow <= 5 && (
                                <button type="button" className="imcrm-ml-auto imcrm-text-[11px] imcrm-text-primary hover:imcrm-underline" onClick={() => onCopyWeekdays(dow)}>
                                    {__('Copiar a lun–vie')}
                                </button>
                            )}
                        </div>
                        {day.map((t, i) => (
                            // v0.1.467 — en el celular los horarios se achican para que la × y el + entren en la fila.
                            <div key={i} className="imcrm-flex imcrm-items-center imcrm-gap-1.5 sm:imcrm-pl-6">
                                <Input
                                    type="time"
                                    step={300}
                                    value={t.start}
                                    onChange={(e) => onDay(dow, day.map((x, j) => (j === i ? { ...x, start: e.target.value || x.start } : x)))}
                                    className="imcrm-h-8 imcrm-min-w-0 imcrm-flex-1 sm:imcrm-w-32 sm:imcrm-flex-none"
                                    disabled={readOnly}
                                    aria-label={__('Desde')}
                                    data-interval-start={`${dow}-${i}`}
                                />
                                <span className="imcrm-text-xs imcrm-text-muted-foreground">–</span>
                                <Input
                                    type="time"
                                    step={300}
                                    value={t.end === '24:00' ? '23:59' : t.end}
                                    onChange={(e) => onDay(dow, day.map((x, j) => (j === i ? { ...x, end: e.target.value || x.end } : x)))}
                                    className="imcrm-h-8 imcrm-min-w-0 imcrm-flex-1 sm:imcrm-w-32 sm:imcrm-flex-none"
                                    disabled={readOnly}
                                    aria-label={__('Hasta')}
                                    data-interval-end={`${dow}-${i}`}
                                />
                                {!readOnly && (
                                    <IconBtn label={__('Quitar el tramo')} onClick={() => onDay(dow, day.filter((_, j) => j !== i))}>
                                        <X className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </IconBtn>
                                )}
                                {!readOnly && i === day.length - 1 && nextInterval(day) && day.length < 6 && (
                                    <IconBtn label={__('Agregar otro tramo')} onClick={() => onDay(dow, [...day, nextInterval(day)!])}>
                                        <Plus className="imcrm-h-3.5 imcrm-w-3.5" />
                                    </IconBtn>
                                )}
                            </div>
                        ))}
                        {problem && <p className="imcrm-text-[11px] imcrm-text-destructive sm:imcrm-pl-6">{__(problem)}</p>}
                    </div>
                );
            })}
        </div>
    );
}
