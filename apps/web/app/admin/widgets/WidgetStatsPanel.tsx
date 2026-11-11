import { useState } from 'react';
import { Eye, Loader2, MessageCircle, MousePointerClick, PanelTopOpen, UserCheck } from 'lucide-react';
import { widgetButtonLabel, widgetRate, type ContactWidgetConfig, type WidgetStatsDto } from '@imagina-base/shared';

import { BarList, Section, withShares } from '@/admin/forms/FormStatsSheet';
import { StatTile } from '@/components/ui/stat-tile';
import { __ } from '@/lib/i18n';
import { formatDateStr, formatNumber } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { useWidgetStats } from './useContactWidgets';

const RANGES = [7, 30, 90] as const;

/**
 * v0.1.396 (ADR-S99) — Estadísticas del widget: cuántas veces apareció, cuántas
 * lo abrieron, qué botón tocan más y cuántos dejaron sus datos (o agendaron)
 * por cada botón. Son conteos, nunca datos de una persona.
 */
export function WidgetStatsPanel({ widgetId, config }: { widgetId: number; config: ContactWidgetConfig }): JSX.Element {
    const [days, setDays] = useState<(typeof RANGES)[number]>(30);
    const stats = useWidgetStats(widgetId, days);
    const data = stats.data;
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-5" data-tour="widget-stats" data-testid="widget-stats">
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
                        data-testid={`widget-stats-range-${r}`}
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
                <StatsBody data={data} config={config} />
            )}
        </section>
    );
}

function StatsBody({ data, config }: { data: WidgetStatsDto; config: ContactWidgetConfig }): JSX.Element {
    const empty = data.views === 0 && data.opens === 0 && data.clicks === 0 && data.leads === 0;
    const label = (id: string): string => {
        const b = config.buttons.find((x) => x.id === id);
        return b ? widgetButtonLabel(b) : __('Un botón que ya no está');
    };
    return (
        <>
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3 lg:imcrm-grid-cols-4" data-testid="widget-stats-kpis">
                <StatTile icon={Eye} label={__('Apariciones')} value={formatNumber(data.views)} hint={__('Páginas donde se vio')} />
                <StatTile icon={PanelTopOpen} label={__('Lo abrieron')} value={formatNumber(data.opens)} hint={`${widgetRate(data.opens, data.views)} ${__('de las apariciones')}`} />
                <StatTile icon={MousePointerClick} label={__('Toques en botones')} value={formatNumber(data.clicks)} />
                <StatTile icon={UserCheck} label={__('Contactos')} value={formatNumber(data.leads)} hint={__('Dejaron sus datos o agendaron')} />
            </div>
            {empty ? (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-8 imcrm-text-center" data-testid="widget-stats-empty">
                    <p className="imcrm-text-sm imcrm-font-medium">{__('Todavía no hay visitas en este período')}</p>
                    <p className="imcrm-mx-auto imcrm-mt-1 imcrm-max-w-sm imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Publica el widget y pega el código en tu sitio: cada vez que aparece, que lo abren y que tocan un botón se cuenta aquí.')}
                    </p>
                </div>
            ) : (
                <>
                    <Section title={__('Día por día')}>
                        <DailyChart data={data} />
                    </Section>
                    <Section title={__('Por botón')} hint={__('Toques y contactos de cada botón. Un contacto es alguien que dejó sus datos en el formulario o agendó desde ese botón.')}>
                        <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border" data-testid="widget-stats-buttons">
                            {data.buttons.length === 0 && <li className="imcrm-px-3 imcrm-py-2.5 imcrm-text-xs imcrm-text-muted-foreground">—</li>}
                            {data.buttons.map((b) => (
                                <li key={b.id} className="imcrm-flex imcrm-items-center imcrm-justify-between imcrm-gap-3 imcrm-px-3 imcrm-py-2.5 imcrm-text-sm" data-row={b.id}>
                                    <span className="imcrm-min-w-0 imcrm-truncate">{label(b.id)}</span>
                                    <span className="imcrm-flex imcrm-shrink-0 imcrm-gap-4 imcrm-tabular-nums imcrm-text-xs imcrm-text-muted-foreground">
                                        <span>
                                            <span className="imcrm-font-medium imcrm-text-foreground">{formatNumber(b.clicks)}</span> {b.clicks === 1 ? __('toque') : __('toques')}
                                        </span>
                                        <span>
                                            <span className="imcrm-font-medium imcrm-text-foreground">{formatNumber(b.leads)}</span> {b.leads === 1 ? __('contacto') : __('contactos')}
                                        </span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </Section>
                    <div className="imcrm-grid imcrm-gap-5 md:imcrm-grid-cols-2">
                        <Section title={__('Dispositivo')}>
                            <BarList
                                testId="widget-stats-devices"
                                rows={withShares([
                                    { key: 'mobile', label: __('Celular'), value: data.mobile, note: widgetRate(data.mobile, data.mobile + data.desktop) },
                                    { key: 'desktop', label: __('Computador'), value: data.desktop, note: widgetRate(data.desktop, data.mobile + data.desktop) },
                                ])}
                            />
                        </Section>
                        {data.greetings > 0 && (
                            <Section title={__('El saludo')}>
                                <p className="imcrm-flex imcrm-items-center imcrm-gap-2 imcrm-text-sm" data-testid="widget-stats-greeting">
                                    <MessageCircle className="imcrm-h-4 imcrm-w-4 imcrm-text-muted-foreground" />
                                    {(data.greetings === 1 ? __('Se vio %1 vez y lo tocaron %2 (%3).') : __('Se vio %1 veces y lo tocaron %2 (%3).'))
                                        .replace('%1', formatNumber(data.greetings))
                                        .replace('%2', formatNumber(data.greeting_clicks))
                                        .replace('%3', widgetRate(data.greeting_clicks, data.greetings))}
                                </p>
                            </Section>
                        )}
                    </div>
                </>
            )}
        </>
    );
}

/** Apariciones (columna clara) y contactos (columna llena) por día. */
function DailyChart({ data }: { data: WidgetStatsDto }): JSX.Element {
    const [hover, setHover] = useState<number | null>(null);
    const days = data.days;
    const max = Math.max(1, ...days.map((d) => Math.max(d.views, d.leads)));
    const W = 600;
    const H = 140;
    const pad = { l: 28, r: 4, t: 8, b: 20 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const slot = iw / Math.max(1, days.length);
    const bw = Math.max(2, Math.min(18, slot - 2));
    const y = (v: number): number => pad.t + ih - (v / max) * ih;
    const ticks = [0, Math.ceil(max / 2), max].filter((v, i, a) => a.indexOf(v) === i);
    const labelIdx = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((v, i, a) => v >= 0 && a.indexOf(v) === i);
    const h = hover !== null ? days[hover] : null;
    return (
        <div className="imcrm-relative" data-testid="widget-stats-daily">
            <div className="imcrm-mb-1 imcrm-flex imcrm-items-center imcrm-gap-4 imcrm-text-[11px] imcrm-text-muted-foreground">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                    <span className="imcrm-inline-block imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-sm imcrm-bg-primary/25" aria-hidden />
                    {__('Apariciones')}
                </span>
                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                    <span className="imcrm-inline-block imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-sm imcrm-bg-primary" aria-hidden />
                    {__('Contactos')}
                </span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="imcrm-h-auto imcrm-w-full imcrm-overflow-visible" role="img" aria-label={__('Apariciones y contactos por día')} onMouseLeave={() => setHover(null)}>
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
                            {d.leads > 0 && <rect x={x + (bw - inner) / 2} y={y(d.leads)} width={inner} height={pad.t + ih - y(d.leads)} rx={Math.min(2, inner / 2)} className="imcrm-fill-primary" />}
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
                <div className="imcrm-pointer-events-none imcrm-absolute imcrm-top-0 imcrm-right-0 imcrm-rounded-md imcrm-border imcrm-border-border imcrm-bg-popover imcrm-px-2.5 imcrm-py-1.5 imcrm-text-[11px] imcrm-shadow-sm">
                    <p className="imcrm-font-medium imcrm-text-foreground">{formatDateStr(h.day)}</p>
                    <p className="imcrm-text-muted-foreground">
                        {__('Apariciones')}: <span className="imcrm-text-foreground">{formatNumber(h.views)}</span> · {__('Lo abrieron')}:{' '}
                        <span className="imcrm-text-foreground">{formatNumber(h.opens)}</span> · {__('Contactos')}: <span className="imcrm-text-foreground">{formatNumber(h.leads)}</span>
                    </p>
                </div>
            )}
        </div>
    );
}
