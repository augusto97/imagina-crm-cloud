import { useMemo, useState } from 'react';
import { BarChart3, Clock, Eye, Loader2, MousePointerClick, Send } from 'lucide-react';
import type { FormDto, FormStatsDto } from '@imagina-base/shared';

import { Sheet, SheetBody, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { StatTile } from '@/components/ui/stat-tile';
import { __ } from '@/lib/i18n';
import { formatDateStr, formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';
import type { FieldEntity } from '@/types/field';

import { durationLabel, funnelRows, percentLabel, questionLabel, sourceLabel } from './formStatsView';
import { useFormStats } from './useForms';

const RANGES = [7, 30, 90] as const;
const DEVICE_LABELS: Record<keyof FormStatsDto['devices'], string> = { mobile: 'Celular', tablet: 'Tableta', desktop: 'Computador' };

/**
 * v0.1.358 — Estadísticas de un formulario: cuántos lo vieron, empezaron y
 * enviaron; hasta dónde llegan; en qué pregunta lo dejan; de dónde vienen y
 * desde qué dispositivo. Son contadores, nunca datos de una persona.
 */
export function FormStatsSheet({
    open,
    onOpenChange,
    listId,
    form,
    fields,
}: {
    open: boolean;
    onOpenChange: (o: boolean) => void;
    listId: number;
    form: FormDto;
    fields: FieldEntity[];
}): JSX.Element {
    const [days, setDays] = useState<(typeof RANGES)[number]>(30);
    const stats = useFormStats(listId, open ? form.id : null, days);
    const data = stats.data;

    return (
        <Sheet open={open} onOpenChange={onOpenChange}>
            <SheetContent className="sm:imcrm-w-[680px]" data-testid="form-stats">
                <SheetHeader>
                    <div className="imcrm-min-w-0 imcrm-pr-8">
                        <SheetTitle className="imcrm-flex imcrm-items-center imcrm-gap-2">
                            <BarChart3 className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" aria-hidden />
                            <span className="imcrm-truncate">{__('Estadísticas')} · {form.name}</span>
                        </SheetTitle>
                        <SheetDescription>{__('Cuántos lo ven, lo empiezan y lo envían. Son conteos: no se guarda nada de cada persona.')}</SheetDescription>
                    </div>
                </SheetHeader>
                <SheetBody className="imcrm-flex imcrm-flex-col imcrm-gap-5">
                    <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2" role="radiogroup" aria-label={__('Período')}>
                        {RANGES.map((r) => (
                            <button
                                key={r}
                                type="button"
                                role="radio"
                                aria-checked={days === r}
                                onClick={() => setDays(r)}
                                className={cn(
                                    'imcrm-rounded-full imcrm-border imcrm-px-3 imcrm-py-1 imcrm-text-xs imcrm-font-medium imcrm-transition-colors',
                                    days === r ? 'imcrm-border-primary imcrm-bg-primary/10 imcrm-text-primary' : 'imcrm-border-border hover:imcrm-bg-accent',
                                )}
                                data-testid={`form-stats-range-${r}`}
                            >
                                {__('Últimos %s días').replace('%s', String(r))}
                            </button>
                        ))}
                        {stats.isFetching && <Loader2 className="imcrm-h-3.5 imcrm-w-3.5 imcrm-animate-spin imcrm-text-muted-foreground" aria-label={__('Actualizando')} />}
                    </div>

                    {stats.isLoading || !data ? (
                        stats.isError ? (
                            <p className="imcrm-text-sm imcrm-text-destructive">{__('No se pudieron cargar las estadísticas.')}</p>
                        ) : (
                            <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm imcrm-text-muted-foreground">
                                <Loader2 className="imcrm-h-4 imcrm-w-4 imcrm-animate-spin" />
                                {__('Cargando…')}
                            </p>
                        )
                    ) : (
                        <StatsBody data={data} form={form} fields={fields} />
                    )}
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}

function StatsBody({ data, form, fields }: { data: FormStatsDto; form: FormDto; fields: FieldEntity[] }): JSX.Element {
    const t = data.totals;
    const funnel = useMemo(() => funnelRows(data), [data]);
    const empty = t.views === 0 && t.starts === 0 && t.submits === 0;
    return (
        <>
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3 md:imcrm-grid-cols-4" data-testid="form-stats-kpis">
                <StatTile icon={Eye} label={__('Visitas')} value={formatNumber(t.views)} />
                <StatTile icon={MousePointerClick} label={__('Empezaron')} value={formatNumber(t.starts)} hint={t.start_rate !== null ? `${percentLabel(t.start_rate)} ${__('de las visitas')}` : undefined} />
                <StatTile icon={Send} label={__('Enviaron')} value={formatNumber(t.submits)} hint={t.completion_rate !== null ? `${percentLabel(t.completion_rate)} ${__('de los que empezaron')}` : undefined} />
                <StatTile icon={Clock} label={__('Tiempo promedio')} value={durationLabel(t.avg_seconds)} hint={__('de empezar a enviar')} />
            </div>

            {empty ? (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-8 imcrm-text-center" data-testid="form-stats-empty">
                    <p className="imcrm-text-sm imcrm-font-medium">{__('Todavía no hay visitas en este período')}</p>
                    <p className="imcrm-mx-auto imcrm-mt-1 imcrm-max-w-sm imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Comparte el enlace o insértalo en tu sitio: cada visita, cada persona que empieza y cada envío se cuentan aquí.')}
                        {data.all_time_submits ? ` ${__('Desde siempre llegaron %s respuestas.').replace('%s', formatNumber(data.all_time_submits))}` : ''}
                    </p>
                </div>
            ) : (
                <>
                    <Section title={__('Día por día')}>
                        <DailyChart data={data} />
                    </Section>
                    <Section title={__('Hasta dónde llegan')} hint={__('Sobre las visitas del período.')}>
                        <BarList testId="form-stats-funnel" rows={funnel.map((r) => ({ key: r.key, label: __(r.label), value: r.value, note: percentLabel(r.share), share: r.share ?? 0 }))} />
                    </Section>
                    {data.leaves.length > 0 && (
                        <Section title={__('Dónde lo dejan')} hint={__('La última pregunta que tocaron quienes se fueron sin enviar.')}>
                            <BarList
                                testId="form-stats-leaves"
                                rows={withShares(data.leaves.map((l) => ({ key: l.item, label: questionLabel(l.item, form.config, fields), value: l.count })))}
                            />
                        </Section>
                    )}
                    <div className="imcrm-grid imcrm-gap-5 md:imcrm-grid-cols-2">
                        <Section title={__('De dónde llegan')}>
                            {data.sources.length ? (
                                <BarList testId="form-stats-sources" rows={withShares(data.sources.map((s) => ({ key: s.key, label: __(sourceLabel(s.key)), value: s.count })))} />
                            ) : (
                                <p className="imcrm-text-xs imcrm-text-muted-foreground">—</p>
                            )}
                        </Section>
                        <Section title={__('Dispositivo')}>
                            <BarList
                                testId="form-stats-devices"
                                rows={withShares(
                                    (Object.keys(DEVICE_LABELS) as Array<keyof FormStatsDto['devices']>).map((k) => ({ key: k, label: __(DEVICE_LABELS[k]), value: data.devices[k] })),
                                )}
                            />
                        </Section>
                    </div>
                    <p className="imcrm-text-[11px] imcrm-leading-snug imcrm-text-muted-foreground">
                        {__('Una visita cuenta una vez por pestaña. «De dónde llegan» toma la campaña del enlace (utm_source) o el sitio anterior; si está insertado, el sitio donde está. Los números de hoy pueden tardar un par de minutos.')}
                    </p>
                </>
            )}
        </>
    );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }): JSX.Element {
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-2">
            <div>
                <h3 className="imcrm-text-sm imcrm-font-semibold">{title}</h3>
                {hint && <p className="imcrm-text-xs imcrm-text-muted-foreground">{hint}</p>}
            </div>
            {children}
        </section>
    );
}

interface BarRow {
    key: string;
    label: string;
    value: number;
    note?: string;
    /** 0-1: el largo de la barra. */
    share: number;
}

function withShares(rows: Array<Omit<BarRow, 'share'>>): BarRow[] {
    const max = Math.max(1, ...rows.map((r) => r.value));
    return rows.map((r) => ({ ...r, share: r.value / max }));
}

function BarList({ rows, testId }: { rows: BarRow[]; testId: string }): JSX.Element {
    return (
        <ul className="imcrm-flex imcrm-flex-col imcrm-gap-2" data-testid={testId}>
            {rows.map((r) => (
                <li key={r.key} className="imcrm-flex imcrm-flex-col imcrm-gap-1" data-row={r.key}>
                    <div className="imcrm-flex imcrm-items-baseline imcrm-justify-between imcrm-gap-3 imcrm-text-xs">
                        <span className="imcrm-min-w-0 imcrm-truncate imcrm-text-foreground" title={r.label}>
                            {r.label}
                        </span>
                        <span className="imcrm-shrink-0 imcrm-tabular-nums imcrm-text-muted-foreground">
                            <span className="imcrm-font-medium imcrm-text-foreground">{formatNumber(r.value)}</span>
                            {r.note && r.note !== '—' ? ` · ${r.note}` : ''}
                        </span>
                    </div>
                    <div className="imcrm-h-2 imcrm-overflow-hidden imcrm-rounded-full imcrm-bg-muted" aria-hidden>
                        <div className="imcrm-h-full imcrm-rounded-full imcrm-bg-primary" style={{ width: `${Math.max(r.value > 0 ? 2 : 0, Math.round(r.share * 100))}%` }} />
                    </div>
                </li>
            ))}
        </ul>
    );
}

/**
 * Visitas (columna clara) y envíos (columna llena, al frente) por día, con el
 * mismo eje. Al pasar el mouse (o tocar), el detalle del día.
 */
function DailyChart({ data }: { data: FormStatsDto }): JSX.Element {
    const [hover, setHover] = useState<number | null>(null);
    const days = data.days;
    const max = Math.max(1, ...days.map((d) => Math.max(d.views, d.submits)));
    const W = 600;
    const H = 140;
    const pad = { l: 28, r: 4, t: 8, b: 20 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const slot = iw / days.length;
    const bw = Math.max(2, Math.min(18, slot - 2));
    const y = (v: number): number => pad.t + ih - (v / max) * ih;
    const ticks = [0, Math.ceil(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
    const labelIdx = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, i, a) => a.indexOf(v) === i);
    const h = hover !== null ? days[hover] : null;
    return (
        <div className="imcrm-relative" data-testid="form-stats-daily">
            <div className="imcrm-mb-1 imcrm-flex imcrm-items-center imcrm-gap-4 imcrm-text-[11px] imcrm-text-muted-foreground">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                    <span className="imcrm-inline-block imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-sm imcrm-bg-primary/25" aria-hidden />
                    {__('Visitas')}
                </span>
                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                    <span className="imcrm-inline-block imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-sm imcrm-bg-primary" aria-hidden />
                    {__('Enviaron')}
                </span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="imcrm-h-auto imcrm-w-full imcrm-overflow-visible" role="img" aria-label={__('Visitas y envíos por día')} onMouseLeave={() => setHover(null)}>
                {ticks.map((v) => (
                    <g key={v}>
                        <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} className="imcrm-stroke-border" strokeWidth={1} strokeDasharray={v === 0 ? undefined : '3 3'} />
                        <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="imcrm-fill-muted-foreground" style={{ fontSize: 10 }}>
                            {formatNumber(v)}
                        </text>
                    </g>
                ))}
                {days.map((d, i) => {
                    const x = pad.l + i * slot + (slot - bw) / 2;
                    const inner = Math.max(1.5, bw * 0.55);
                    return (
                        <g key={d.day} onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}>
                            <rect x={pad.l + i * slot} y={pad.t} width={slot} height={ih} fill="transparent" />
                            {d.views > 0 && <rect x={x} y={y(d.views)} width={bw} height={pad.t + ih - y(d.views)} rx={Math.min(3, bw / 2)} className="imcrm-fill-primary/25" />}
                            {d.submits > 0 && (
                                <rect x={x + (bw - inner) / 2} y={y(d.submits)} width={inner} height={pad.t + ih - y(d.submits)} rx={Math.min(2, inner / 2)} className="imcrm-fill-primary" />
                            )}
                            {hover === i && <rect x={pad.l + i * slot} y={pad.t} width={slot} height={ih} className="imcrm-fill-foreground/5" />}
                        </g>
                    );
                })}
                {labelIdx.map((i) => (
                    <text
                        key={i}
                        x={pad.l + i * slot + slot / 2}
                        y={H - 4}
                        textAnchor={i === 0 ? 'start' : i === days.length - 1 ? 'end' : 'middle'}
                        className="imcrm-fill-muted-foreground"
                        style={{ fontSize: 10 }}
                    >
                        {formatDateStr(days[i]!.day)}
                    </text>
                ))}
            </svg>
            {h && (
                <div
                    className="imcrm-pointer-events-none imcrm-absolute imcrm-top-0 imcrm-right-0 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-popover imcrm-px-2.5 imcrm-py-1.5 imcrm-text-[11px] imcrm-shadow-sm"
                    data-testid="form-stats-tooltip"
                >
                    <p className="imcrm-font-medium imcrm-text-foreground">{formatDateStr(h.day)}</p>
                    <p className="imcrm-text-muted-foreground">
                        {__('Visitas')}: <span className="imcrm-text-foreground">{formatNumber(h.views)}</span> · {__('Empezaron')}: <span className="imcrm-text-foreground">{formatNumber(h.starts)}</span> ·{' '}
                        {__('Enviaron')}: <span className="imcrm-text-foreground">{formatNumber(h.submits)}</span>
                    </p>
                </div>
            )}
        </div>
    );
}
