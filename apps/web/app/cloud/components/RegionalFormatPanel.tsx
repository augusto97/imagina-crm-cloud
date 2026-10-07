import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { timeZoneLabel, type UpdateTenantFormatInput } from '@imagina-base/shared';
import { Globe } from 'lucide-react';

import { brandingQueryKey, useBrandingData } from '@/hooks/useBranding';
import { CloudApiError } from '@/lib/cloud/client';
import {
    browserTimeZone,
    formatNumber,
    formatZonedNow,
    type TenantFormat as TF,
} from '@/lib/tenantFormat';
import { TimeZoneSelect } from '@/components/TimeZoneSelect';
import { api, useSession } from '@/cloud/session';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

const NUMBER_OPTIONS: { value: TF['number_format']; label: string }[] = [
    { value: 'comma_dot', label: '1,234,567.89 — coma para miles, punto decimal' },
    { value: 'dot_comma', label: '1.234.567,89 — punto para miles, coma decimal' },
    { value: 'space_comma', label: '1 234 567,89 — espacio para miles, coma decimal' },
];

const DATE_OPTIONS: { value: TF['date_format']; label: string }[] = [
    { value: 'ymd', label: 'AAAA-MM-DD (2026-12-31)' },
    { value: 'dmy', label: 'DD/MM/AAAA (31/12/2026)' },
    { value: 'mdy', label: 'MM/DD/AAAA (12/31/2026)' },
];

const TIME_OPTIONS: { value: TF['time_format']; label: string }[] = [
    { value: 'h24', label: '24 horas (14:30)' },
    { value: 'h12', label: '12 horas (2:30 p. m.)' },
];

/**
 * Card "Formato regional" de Ajustes (v0.1.104, sólo admin): cómo se muestran
 * números, fechas y horas en TODO el workspace (tabla, ficha, dashboards y el
 * portal del cliente). Vive en `tenants.settings.format` y viaja con el
 * branding en el boot. La vista previa se recalcula en vivo con la selección.
 */
export function RegionalFormatPanel(): JSX.Element {
    const qc = useQueryClient();
    const tenantId = useSession((s) => s.activeTenantId);
    const brandingQ = useBrandingData();

    const [numberFormat, setNumberFormat] = useState<TF['number_format']>('comma_dot');
    const [dateFormat, setDateFormat] = useState<TF['date_format']>('ymd');
    const [timeFormat, setTimeFormat] = useState<TF['time_format']>('h24');
    const [timeZone, setTimeZone] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

    // Rehidratar cuando llega el formato del tenant — pero NUNCA pisar una
    // selección que el usuario ya tocó (el query puede resolver tarde).
    const touched = useRef(false);
    const saved = brandingQ.data?.format;
    useEffect(() => {
        if (!saved || touched.current) return;
        setNumberFormat(saved.number_format);
        setDateFormat(saved.date_format);
        setTimeFormat(saved.time_format);
        setTimeZone(saved.timezone ?? null);
    }, [saved]);

    const save = useMutation({
        mutationFn: (patch: UpdateTenantFormatInput) => api.updateTenantFormat(patch),
        onSuccess: () => {
            setNotice({ kind: 'ok', text: 'Formato guardado. Se aplica en toda la app.' });
            // useBranding re-publica el formato al refetchear el branding.
            void qc.invalidateQueries({ queryKey: brandingQueryKey(tenantId) });
        },
        onError: (e: unknown) =>
            setNotice({ kind: 'err', text: e instanceof CloudApiError ? e.message : 'No se pudo guardar.' }),
    });

    const draft: TF = { number_format: numberFormat, date_format: dateFormat, time_format: timeFormat, timezone: timeZone };
    const browserTz = browserTimeZone();
    // La vista previa muestra la fecha y la hora REALES de la zona elegida (un
    // ejemplo fijo se leía como si fuera la hora de ahora). Se refresca sola.
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = window.setInterval(() => setNow(new Date()), 15_000);
        return () => window.clearInterval(id);
    }, []);
    const zoned = formatZonedNow(timeZone, draft, now);
    const zoneName = timeZone ? timeZoneLabel(timeZone) : 'UTC';

    const dirty =
        saved !== undefined &&
        (saved.number_format !== numberFormat ||
            saved.date_format !== dateFormat ||
            saved.time_format !== timeFormat ||
            (saved.timezone ?? null) !== timeZone);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                    <Globe className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                    Formato regional
                </CardTitle>
                <CardDescription>
                    Cómo se muestran números, fechas y horas en todo el workspace (tablas, fichas,
                    dashboards y el portal del cliente), y en qué zona horaria trabaja la empresa. En
                    Latinoamérica y Europa se suele usar punto para los miles y coma para los decimales.
                </CardDescription>
            </CardHeader>
            <CardContent className="imcrm-space-y-4">
                <FormatRow label="Números" htmlFor="fmt-number">
                    <select
                        id="fmt-number"
                        className="imcrm-h-9 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-text-sm"
                        value={numberFormat}
                        onChange={(e) => { touched.current = true; setNumberFormat(e.target.value as TF['number_format']); }}
                    >
                        {NUMBER_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                </FormatRow>
                <FormatRow label="Fecha" htmlFor="fmt-date">
                    <select
                        id="fmt-date"
                        className="imcrm-h-9 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-text-sm"
                        value={dateFormat}
                        onChange={(e) => { touched.current = true; setDateFormat(e.target.value as TF['date_format']); }}
                    >
                        {DATE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                </FormatRow>
                <FormatRow label="Hora" htmlFor="fmt-time">
                    <select
                        id="fmt-time"
                        className="imcrm-h-9 imcrm-w-full imcrm-rounded-md imcrm-border imcrm-border-input imcrm-bg-background imcrm-px-3 imcrm-text-sm"
                        value={timeFormat}
                        onChange={(e) => { touched.current = true; setTimeFormat(e.target.value as TF['time_format']); }}
                    >
                        {TIME_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                    </select>
                </FormatRow>

                <FormatRow label="Zona horaria" htmlFor="fmt-tz">
                    <TimeZoneSelect
                        id="fmt-tz"
                        testId="fmt-timezone"
                        value={timeZone}
                        emptyLabel="Sin elegir (se usa UTC)"
                        onChange={(tz) => { touched.current = true; setTimeZone(tz); }}
                    />
                    <p className="imcrm-text-xs imcrm-text-muted-foreground">
                        Manda en los horarios de las automatizaciones («todos los días a las 8»), en
                        las fechas sin hora (vencimientos y recurrencias) y en «hoy» o «esta semana» de
                        filtros y tableros.{timeZone ? '' : ' Sin zona, todo corre en UTC.'}
                    </p>
                    {browserTz && browserTz !== timeZone && (
                        <button
                            type="button"
                            className="imcrm-justify-self-start imcrm-text-xs imcrm-font-medium imcrm-text-primary hover:imcrm-underline"
                            onClick={() => { touched.current = true; setTimeZone(browserTz); }}
                        >
                            Usar la de este equipo ({browserTz.replace(/_/g, ' ')})
                        </button>
                    )}
                </FormatRow>

                <div
                    className="imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-muted/40 imcrm-px-3 imcrm-py-2.5"
                    data-testid="format-preview"
                    data-loaded={saved !== undefined ? '1' : '0'}
                >
                    <p className="imcrm-text-xs imcrm-font-medium imcrm-uppercase imcrm-tracking-wide imcrm-text-muted-foreground">
                        Vista previa · ahora en {zoneName}
                    </p>
                    <dl className="imcrm-mt-1.5 imcrm-grid imcrm-grid-cols-1 imcrm-gap-x-6 imcrm-gap-y-1 sm:imcrm-grid-cols-3">
                        <PreviewItem label="Fecha de hoy" value={zoned.date} testId="format-preview-date" />
                        <PreviewItem label="Hora actual" value={zoned.time} testId="format-preview-time" />
                        <PreviewItem
                            label="Un número de ejemplo"
                            value={formatNumber(1234567.89, { minFrac: 2, maxFrac: 2 }, draft)}
                            testId="format-preview-number"
                        />
                    </dl>
                </div>

                <div className="imcrm-flex imcrm-items-center imcrm-gap-3">
                    <Button
                        size="sm"
                        disabled={save.isPending || !dirty}
                        onClick={() => save.mutate(draft)}
                    >
                        {save.isPending ? 'Guardando…' : 'Guardar'}
                    </Button>
                    {notice && (
                        <p className={notice.kind === 'ok' ? 'imcrm-text-sm imcrm-text-emerald-600' : 'imcrm-text-sm imcrm-text-destructive'}>
                            {notice.text}
                        </p>
                    )}
                </div>
            </CardContent>
        </Card>
    );
}

function FormatRow({
    label,
    htmlFor,
    children,
}: {
    label: string;
    htmlFor: string;
    children: React.ReactNode;
}): JSX.Element {
    return (
        <div className="imcrm-grid imcrm-gap-1.5">
            <label htmlFor={htmlFor} className="imcrm-text-sm imcrm-font-medium">
                {label}
            </label>
            {children}
        </div>
    );
}

function PreviewItem({ label, value, testId }: { label: string; value: string; testId: string }): JSX.Element {
    return (
        <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-gap-2 sm:imcrm-block">
            <dt className="imcrm-text-xs imcrm-text-muted-foreground">{label}</dt>
            <dd className="imcrm-text-sm imcrm-font-medium imcrm-tabular-nums" data-testid={testId}>
                {value}
            </dd>
        </div>
    );
}

