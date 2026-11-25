import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    HOLIDAY_COUNTRIES,
    companyCalendar,
    defaultCompanyHours,
    describeCompanyHours,
    describeCompanyStatus,
    timeZoneLabel,
    updateCompanyHoursSchema,
    type CompanyHours,
    type CompanyHolidayRow,
    type CompanyHoursInterval,
} from '@imagina-base/shared';
import { CalendarOff, Clock } from 'lucide-react';

import { WeekHoursEditor } from '@/admin/booking/WeekHoursEditor';
import { api, useSession } from '@/cloud/session';
import { companyHoursKey, useCompanyHours } from '@/hooks/useCompanyHours';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { CloudApiError } from '@/lib/cloud/client';
import { __, sprintf } from '@/lib/i18n';
import { formatDateStr, getTenantFormat } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

function sameHours(a: CompanyHours, b: CompanyHours): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

function weekdayOf(ymd: string): string {
    const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
    return __(DAY_NAMES[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!);
}

/**
 * v0.1.467 (E8) — Ajustes → Horario laboral. Cuándo trabaja la empresa: los
 * días con sus tramos y los festivos de su país. Lo usan las automatizaciones
 * que esperan «hasta un día laborable» o «hasta el horario laboral». Lo edita
 * el admin; el resto del equipo lo ve (para saber cuándo seguirá una espera).
 */
export function CompanyHoursPanel({ canEdit }: { canEdit: boolean }): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const q = useCompanyHours();
    const timeFormat = getTenantFormat().time_format;

    const [draft, setDraft] = useState<CompanyHours | null>(null);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
    // La respuesta del servidor no pisa lo que la persona ya tocó.
    const touched = useRef(false);
    useEffect(() => {
        if (q.data && !touched.current) setDraft(q.data.hours);
    }, [q.data]);

    const edit = (next: CompanyHours): void => {
        touched.current = true;
        setNotice(null);
        setDraft(next);
    };

    const nowYear = new Date().getFullYear();
    const [year, setYear] = useState(nowYear);
    const country = draft?.holiday_country ?? null;
    const regional = draft?.regional_holidays ?? false;
    const holidayQuery = (y: number) => ({
        queryKey: ['business-hours-holidays', tenantId, country, y, regional],
        queryFn: () => api.getBusinessHolidays({ country, year: y, regional }),
        enabled: draft !== null && country !== null,
        staleTime: 10 * 60_000,
    });
    const listQ = useQuery(holidayQuery(year));
    // La vista previa mira este año y el que viene (en diciembre, abrir puede caer en enero).
    const thisYearQ = useQuery(holidayQuery(nowYear));
    const nextYearQ = useQuery(holidayQuery(nowYear + 1));

    const timezone = q.data?.timezone ?? null;
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const t = window.setInterval(() => setNow(new Date()), 30_000);
        return () => window.clearInterval(t);
    }, []);

    const closed = useMemo(() => {
        const set = new Set<string>();
        for (const r of [...(thisYearQ.data?.holidays ?? []), ...(nextYearQ.data?.holidays ?? [])]) if (r.closed) set.add(r.date);
        return set;
    }, [thisYearQ.data, nextYearQ.data]);

    const parsed = draft ? updateCompanyHoursSchema.safeParse(draft) : null;
    const problem = parsed && !parsed.success ? parsed.error.issues[0]?.message ?? __('Revisa el horario.') : null;
    const status = draft ? describeCompanyStatus(companyCalendar(draft, timezone, closed), now, timeFormat) : null;
    const dirty = !!(draft && q.data && !sameHours(draft, q.data.hours));

    const save = useMutation({
        mutationFn: (hours: CompanyHours) => api.updateBusinessHours(hours),
        onSuccess: (res) => {
            touched.current = false;
            setDraft(res.hours);
            qc.setQueryData(companyHoursKey(tenantId), res);
            setNotice({ kind: 'ok', text: __('Horario guardado. Las automatizaciones que esperan lo usan desde ya.') });
        },
        onError: (e: unknown) => setNotice({ kind: 'err', text: e instanceof CloudApiError ? e.message : __('No se pudo guardar.') }),
    });

    if (q.isLoading || !draft) {
        return <Card className="imcrm-h-40 imcrm-animate-pulse" />;
    }
    if (q.isError) {
        return <p className="imcrm-text-sm imcrm-text-destructive">{__('No se pudo cargar el horario laboral.')}</p>;
    }

    const setDay = (dow: number, intervals: CompanyHoursInterval[]): void => {
        edit({ ...draft, week: draft.week.map((d, i) => (i === dow ? intervals : d)) });
    };
    const copyWeekdays = (dow: number): void => {
        const src = draft.week[dow] ?? [];
        edit({ ...draft, week: draft.week.map((d, i) => (i >= 1 && i <= 5 ? src.map((x) => ({ ...x })) : d)) });
    };
    const holidays: CompanyHolidayRow[] = listQ.data?.holidays ?? [];
    const countryName = HOLIDAY_COUNTRIES.find((c) => c.code === country)?.name ?? country;

    return (
        <Card data-testid="company-hours-panel">
            <CardHeader>
                <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-base">
                    <Clock className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                    {__('Horario laboral')}
                </CardTitle>
                <CardDescription>
                    {__('Los días y las horas en que trabaja la empresa. Lo usan las automatizaciones que esperan «hasta un día laborable» o «hasta el horario laboral»: así un mensaje no sale un domingo ni un festivo.')}
                </CardDescription>
            </CardHeader>
            <CardContent className="imcrm-flex imcrm-flex-col imcrm-gap-5">
                {status && (
                    <div
                        className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-x-3 imcrm-gap-y-1 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-3 imcrm-py-2.5"
                        data-tour="business-hours-status"
                        data-testid="company-hours-status"
                    >
                        <span className={cn('imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-full', status.open ? 'imcrm-bg-emerald-500' : 'imcrm-bg-muted-foreground/50')} aria-hidden />
                        <span className="imcrm-text-sm imcrm-font-medium">{status.text}</span>
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">
                            {timezone
                                ? sprintf(__('Hora de %s'), timeZoneLabel(timezone))
                                : __('La empresa no eligió zona horaria: se usa UTC.')}
                            {canEdit && (
                                <>
                                    {' · '}
                                    <Link to="/settings?s=formato" className="imcrm-text-primary hover:imcrm-underline">
                                        {__('Cambiar la zona')}
                                    </Link>
                                </>
                            )}
                        </span>
                    </div>
                )}

                {!q.data?.configured && (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground" data-testid="company-hours-default-note">
                        {__('Es el horario de fábrica (lunes a viernes de 8:00 a 17:00, sin los festivos del país de tu zona horaria). Cámbialo si tu empresa trabaja otros días u horas.')}
                    </p>
                )}

                <section className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-tour="business-hours-week">
                    <h3 className="imcrm-text-sm imcrm-font-semibold">{__('Días y horas')}</h3>
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Un día puede tener varios tramos (por ejemplo, de 8:00 a 12:00 y de 14:00 a 18:00 para el almuerzo).')}
                    </p>
                    <WeekHoursEditor
                        week={draft.week}
                        onDay={setDay}
                        onCopyWeekdays={canEdit ? copyWeekdays : undefined}
                        readOnly={!canEdit}
                        emptyLabel={__('No se trabaja')}
                        testId="company-hours-week"
                    />
                </section>

                <section className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-tour="business-hours-holidays">
                    <h3 className="imcrm-text-sm imcrm-font-semibold">{__('Festivos')}</h3>
                    <Select
                        value={country ?? ''}
                        disabled={!canEdit}
                        onChange={(e) => edit({ ...draft, holiday_country: e.target.value || null })}
                        data-testid="company-hours-country"
                        aria-label={__('Festivos')}
                    >
                        <option value="">{__('Se trabaja también los festivos')}</option>
                        {HOLIDAY_COUNTRIES.map((c) => (
                            <option key={c.code} value={c.code}>
                                {sprintf(__('No se trabaja los festivos de %s'), c.name)}
                            </option>
                        ))}
                    </Select>
                    {country && (
                        <label className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm">
                            <input
                                type="checkbox"
                                checked={regional}
                                disabled={!canEdit}
                                onChange={(e) => edit({ ...draft, regional_holidays: e.target.checked })}
                                data-testid="company-hours-regional"
                            />
                            {__('Tampoco se trabaja los festivos regionales')}
                        </label>
                    )}
                    {country && (
                        <div className="imcrm-flex imcrm-flex-col imcrm-gap-2 imcrm-rounded-lg imcrm-border imcrm-border-border imcrm-p-3">
                            <div className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-2">
                                <span className="imcrm-text-xs imcrm-font-medium">{sprintf(__('Festivos de %1$s en %2$d'), countryName ?? '', year)}</span>
                                <div className="imcrm-flex imcrm-gap-1" role="group" aria-label={__('Año')}>
                                    {[nowYear, nowYear + 1].map((y) => (
                                        <button
                                            key={y}
                                            type="button"
                                            onClick={() => setYear(y)}
                                            aria-pressed={y === year}
                                            className={cn(
                                                'imcrm-rounded-md imcrm-px-2 imcrm-py-0.5 imcrm-text-xs',
                                                y === year ? 'imcrm-bg-primary imcrm-text-primary-foreground' : 'imcrm-text-muted-foreground hover:imcrm-bg-accent',
                                            )}
                                        >
                                            {y}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            {listQ.isLoading && <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Trayendo los festivos…')}</p>}
                            {listQ.data?.unavailable && (
                                <p className="imcrm-flex imcrm-items-start imcrm-gap-1.5 imcrm-text-xs imcrm-text-amber-700 dark:imcrm-text-amber-400" data-testid="company-hours-holidays-unavailable">
                                    <CalendarOff className="imcrm-mt-0.5 imcrm-h-3.5 imcrm-w-3.5 imcrm-shrink-0" />
                                    {__('Ahora no pudimos traer los festivos de ese país. Mientras tanto, las automatizaciones calculan sin ellos (nunca se quedan esperando).')}
                                </p>
                            )}
                            {holidays.length > 0 && (
                                <ul className="imcrm-flex imcrm-max-h-64 imcrm-flex-col imcrm-overflow-y-auto imcrm-text-xs" data-testid="company-hours-holidays">
                                    {holidays.map((h) => (
                                        <li key={`${h.date}-${h.name}`} className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-border-b imcrm-border-border/60 imcrm-py-1.5 last:imcrm-border-0">
                                            <span className="imcrm-w-24 imcrm-shrink-0 imcrm-tabular-nums imcrm-text-muted-foreground">{formatDateStr(h.date)}</span>
                                            <span className="imcrm-w-20 imcrm-shrink-0 imcrm-text-muted-foreground">{weekdayOf(h.date)}</span>
                                            <span className="imcrm-min-w-0 imcrm-flex-1 imcrm-truncate">{h.name}</span>
                                            {!h.closed && <Badge variant="outline">{__('Se trabaja')}</Badge>}
                                        </li>
                                    ))}
                                </ul>
                            )}
                            {!listQ.isLoading && !listQ.data?.unavailable && holidays.length === 0 && (
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('No hay festivos ese año.')}</p>
                            )}
                        </div>
                    )}
                </section>

                {problem && <p className="imcrm-text-sm imcrm-text-destructive" data-testid="company-hours-problem">{problem}</p>}
                {notice && (
                    <p className={cn('imcrm-text-sm', notice.kind === 'ok' ? 'imcrm-text-emerald-700 dark:imcrm-text-emerald-400' : 'imcrm-text-destructive')} role="status">
                        {notice.text}
                    </p>
                )}

                {canEdit ? (
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2">
                        <Button onClick={() => save.mutate(draft)} disabled={!!problem || save.isPending || (!dirty && q.data?.configured)} data-testid="company-hours-save">
                            {save.isPending ? __('Guardando…') : __('Guardar horario')}
                        </Button>
                        {dirty && (
                            <Button variant="ghost" onClick={() => edit(q.data!.hours)}>
                                {__('Descartar cambios')}
                            </Button>
                        )}
                        <Button
                            variant="ghost"
                            onClick={() => edit(defaultCompanyHours(timezone))}
                            disabled={sameHours(draft, defaultCompanyHours(timezone))}
                        >
                            {__('Usar el de fábrica')}
                        </Button>
                        <span className="imcrm-text-xs imcrm-text-muted-foreground">{describeCompanyHours(draft, timeFormat)}</span>
                    </div>
                ) : (
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">{__('Sólo un administrador puede cambiar el horario laboral.')}</p>
                )}
            </CardContent>
        </Card>
    );
}

export default CompanyHoursPanel;
