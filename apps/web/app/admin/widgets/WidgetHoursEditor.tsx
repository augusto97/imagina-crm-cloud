import { Clock } from 'lucide-react';
import {
    HOLIDAY_COUNTRIES,
    WIDGET_DEFAULT_CLOSED_MESSAGE,
    holidayCountryForTimeZone,
    timeZoneLabel,
    type ContactWidgetConfig,
    type ContactWidgetOptions,
    type WidgetHours,
} from '@imagina-base/shared';

import { WeekHoursEditor } from '@/admin/booking/BookingRulesParts';
import { Row, Toggle } from '@/admin/records/layout/editor/inspectorUi';
import { TimeZoneSelect } from '@/components/TimeZoneSelect';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { __, sprintf } from '@/lib/i18n';

import { browserTimeZone } from './widgetEditor';

/**
 * v0.1.395 (ADR-S99) — El horario de atención del widget: en qué días y horas
 * se atiende, los festivos de un país, y qué dice el panel fuera de horario.
 * Cada botón elige después si se ve siempre, sólo en horario o sólo fuera.
 */
export function WidgetHoursEditor({
    config,
    options,
    onChange,
}: {
    config: ContactWidgetConfig;
    options: ContactWidgetOptions;
    onChange: (hours: WidgetHours) => void;
}): JSX.Element {
    const h = config.hours;
    const set = (patch: Partial<WidgetHours>): void => onChange({ ...h, ...patch });
    const companyTz = options.timezone ?? null;
    const effectiveTz = h.timezone ?? companyTz;
    const byHours = config.buttons.filter((b) => b.when !== 'always').length;

    const enable = (on: boolean): void => {
        if (!on) return set({ enabled: false });
        // Al encenderlo: si la empresa no eligió zona, la del navegador; y los
        // festivos del país de esa zona (para no empezar en blanco).
        const tz = h.timezone ?? (companyTz ? null : browserTimeZone());
        const country = h.holiday_country ?? holidayCountryForTimeZone(tz ?? companyTz);
        set({ enabled: true, timezone: tz, holiday_country: country });
    };

    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-4" data-tour="widget-hours" data-testid="widget-hours">
            <div className="imcrm-flex imcrm-items-start imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
                <Clock className="imcrm-mt-0.5 imcrm-h-4 imcrm-w-4 imcrm-shrink-0 imcrm-text-muted-foreground" />
                <Toggle
                    label={__('Usar un horario de atención')}
                    hint={__('El panel dice «En línea» o «Fuera de horario» y cuándo vuelven a atender. Cada botón puede verse siempre, sólo en horario (WhatsApp, llamar) o sólo fuera de horario (un formulario para que te escriban).')}
                    checked={h.enabled}
                    onChange={enable}
                    testId="widget-hours-enabled"
                />
            </div>
            {h.enabled && (
                <>
                    <Row label={__('Días y horas en que se atiende')}>
                        <WeekHoursEditor
                            week={h.week}
                            onDay={(dow, intervals) => set({ week: h.week.map((d, i) => (i === dow ? intervals : d)) })}
                            onCopyWeekdays={(dow) => set({ week: h.week.map((d, i) => (i >= 1 && i <= 5 ? h.week[dow]!.map((x) => ({ ...x })) : d)) })}
                            testId="widget-hours-week"
                        />
                    </Row>
                    <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                        <Row label={__('Zona horaria')} hint={__('La persona que visita tu sitio ve la hora en la suya.')}>
                            <TimeZoneSelect
                                value={h.timezone}
                                onChange={(tz) => set({ timezone: tz })}
                                emptyLabel={companyTz ? sprintf(__('La de la empresa (%s)'), timeZoneLabel(companyTz)) : __('La de la empresa (todavía no la eligió: UTC)')}
                                testId="widget-hours-tz"
                            />
                        </Row>
                        <Row label={__('Festivos')} hint={__('Esos días se ven como fuera de horario. Salen del calendario oficial y se actualizan solos.')}>
                            <Select value={h.holiday_country ?? ''} onChange={(e) => set({ holiday_country: e.target.value || null })} data-testid="widget-hours-holidays">
                                <option value="">{__('Se atiende también los festivos')}</option>
                                {HOLIDAY_COUNTRIES.map((c) => (
                                    <option key={c.code} value={c.code}>
                                        {sprintf(__('No se atiende los festivos de %s'), c.name)}
                                    </option>
                                ))}
                            </Select>
                        </Row>
                    </div>
                    {!effectiveTz && (
                        <p className="imcrm-rounded-md imcrm-bg-warning/10 imcrm-p-2 imcrm-text-xs" data-testid="widget-hours-utc">
                            {__('Sin zona horaria, el horario se lee en UTC. Elige la zona aquí o la de la empresa en Ajustes → Formato regional.')}
                        </p>
                    )}
                    <Toggle
                        label={__('Mostrar «En línea» o «Fuera de horario» en el saludo')}
                        checked={h.show_status}
                        onChange={(v) => set({ show_status: v })}
                    />
                    <div className="imcrm-grid imcrm-gap-3 sm:imcrm-grid-cols-2">
                        <Row label={__('Texto en horario')}>
                            <Input value={h.online_label} maxLength={40} onChange={(e) => set({ online_label: e.target.value })} data-testid="widget-hours-online" />
                        </Row>
                        <Row label={__('Mensaje fuera de horario')} hint={__('Debajo se agrega solo cuándo vuelven a atender.')}>
                            <Textarea
                                rows={2}
                                value={h.closed_message}
                                maxLength={200}
                                placeholder={WIDGET_DEFAULT_CLOSED_MESSAGE}
                                onChange={(e) => set({ closed_message: e.target.value })}
                                data-testid="widget-hours-closed-message"
                            />
                        </Row>
                    </div>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {byHours === 0
                            ? __('Todos los botones se ven siempre. En la pestaña Botones elige, en cada uno, «Sólo en horario» o «Sólo fuera de horario».')
                            : sprintf(__('%d botones cambian según el horario. Pruébalo con «En horario» y «Fuera de horario» arriba de la vista previa.'), byHours)}
                    </p>
                </>
            )}
        </section>
    );
}
