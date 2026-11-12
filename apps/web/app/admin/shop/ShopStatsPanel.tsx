import { useState } from 'react';
import { Eye, Loader2, Receipt, ShoppingCart, TrendingUp } from 'lucide-react';
import { SHOP_STATS_RANGES, formStatSourceLabel, formatShopMoney, widgetRate, type ShopStatsDto, type ShopStatsRange } from '@imagina-base/shared';

import { BarList, Section, withShares } from '@/admin/forms/FormStatsSheet';
import { StatTile } from '@/components/ui/stat-tile';
import { __ } from '@/lib/i18n';
import { formatDateStr, formatNumber, getTenantFormat } from '@/lib/tenantFormat';
import { cn } from '@/lib/utils';

import { useShopStats } from './useShops';

const DEVICE_LABELS: Record<keyof ShopStatsDto['devices'], string> = { mobile: 'Celular', tablet: 'Tableta', desktop: 'Computador' };

/**
 * v0.1.418 (addendum ADR-S103) — Cómo vende la tienda: visitas, pedidos,
 * ventas, el embudo (de la visita al pago), los productos que más venden y de
 * dónde llegan los que compran. Las visitas y los clics son conteos, nunca
 * datos de una persona; los pedidos y las ventas salen de los pedidos mismos.
 */
export function ShopStatsPanel({ shopId }: { shopId: number }): JSX.Element {
    const [days, setDays] = useState<ShopStatsRange>(30);
    const stats = useShopStats(shopId, days);
    const data = stats.data;
    return (
        <section className="imcrm-flex imcrm-flex-col imcrm-gap-5" data-tour="shop-stats" data-testid="shop-stats">
            <div className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-gap-2" role="radiogroup" aria-label={__('Período')}>
                {SHOP_STATS_RANGES.map((r) => (
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
                        data-testid={`shop-stats-range-${r}`}
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
                <StatsBody data={data} />
            )}
        </section>
    );
}

function StatsBody({ data }: { data: ShopStatsDto }): JSX.Element {
    const fmt = getTenantFormat().number_format;
    const money = (n: number): string => formatShopMoney(n, data.currency, fmt);
    const t = data.totals;
    const empty = t.visits === 0 && t.orders === 0;
    const visits = t.visits;
    const deviceTotal = data.devices.mobile + data.devices.tablet + data.devices.desktop;
    return (
        <>
            <div className="imcrm-grid imcrm-grid-cols-2 imcrm-gap-3 lg:imcrm-grid-cols-4" data-testid="shop-stats-kpis">
                <StatTile icon={Eye} label={__('Visitas')} value={formatNumber(t.visits)} hint={__('Una por visita, aunque mire varios productos')} />
                <StatTile
                    icon={ShoppingCart}
                    label={__('Pedidos')}
                    value={formatNumber(t.orders)}
                    hint={t.orders === 0 ? undefined : t.paid === 1 ? __('1 pagado') : __('%s pagados').replace('%s', formatNumber(t.paid))}
                />
                <StatTile icon={Receipt} label={__('Ventas')} value={money(t.revenue)} hint={t.average_order !== null ? __('%s por pedido pagado').replace('%s', money(t.average_order)) : __('De los pedidos pagados')} />
                <StatTile icon={TrendingUp} label={__('Conversión')} value={widgetRate(t.paid, t.visits)} hint={__('Visitas que terminaron en un pedido pagado')} />
            </div>
            {empty ? (
                <div className="imcrm-rounded-lg imcrm-border imcrm-border-dashed imcrm-border-border imcrm-px-4 imcrm-py-8 imcrm-text-center" data-testid="shop-stats-empty">
                    <p className="imcrm-text-sm imcrm-font-medium">{__('Todavía no hay visitas en este período')}</p>
                    <p className="imcrm-mx-auto imcrm-mt-1 imcrm-max-w-sm imcrm-text-xs imcrm-text-muted-foreground">
                        {__('Publica la tienda y comparte el enlace: cada visita, cada producto que abren y cada pedido se cuenta aquí.')}
                    </p>
                </div>
            ) : (
                <>
                    <Section title={__('Día por día')}>
                        <DailyChart data={data} money={money} />
                    </Section>
                    <Section title={__('De la visita al pago')} hint={__('Cuántas visitas llegan a cada paso. Si muchas abren productos pero pocas los agregan, revisa precios y fotos; si muchas empiezan la compra y no la terminan, revisa los datos que pides y las formas de pago.')}>
                        <BarList
                            testId="shop-stats-funnel"
                            rows={withShares(data.funnel.map((s, i) => ({ key: s.key, label: __(s.label), value: s.count, note: i === 0 ? undefined : widgetRate(s.count, visits) })))}
                        />
                    </Section>
                    <Section title={__('Productos')} hint={__('Los que más venden, y cuántas veces los abren y los agregan al carrito.')}>
                        <ProductsTable data={data} money={money} />
                    </Section>
                    <Section title={__('De dónde llegan')} hint={__('La campaña (utm_source) o el sitio desde el que llegaron, con lo que compraron.')}>
                        <ul className="imcrm-flex imcrm-flex-col imcrm-divide-y imcrm-divide-border imcrm-rounded-lg imcrm-border imcrm-border-border" data-testid="shop-stats-sources">
                            {data.sources.length === 0 && <li className="imcrm-px-3 imcrm-py-2.5 imcrm-text-xs imcrm-text-muted-foreground">—</li>}
                            {data.sources.map((s) => (
                                <li key={s.key} className="imcrm-flex imcrm-flex-wrap imcrm-items-center imcrm-justify-between imcrm-gap-x-3 imcrm-gap-y-1 imcrm-px-3 imcrm-py-2.5 imcrm-text-sm" data-row={s.key}>
                                    <span className="imcrm-min-w-0 imcrm-truncate">{s.key === 'o' ? __('Otros') : formStatSourceLabel(s.key)}</span>
                                    <span className="imcrm-flex imcrm-shrink-0 imcrm-gap-4 imcrm-tabular-nums imcrm-text-xs imcrm-text-muted-foreground">
                                        <span>
                                            <span className="imcrm-font-medium imcrm-text-foreground">{formatNumber(s.visits)}</span> {s.visits === 1 ? __('visita') : __('visitas')}
                                        </span>
                                        <span>
                                            <span className="imcrm-font-medium imcrm-text-foreground">{formatNumber(s.orders)}</span> {s.orders === 1 ? __('pedido') : __('pedidos')}
                                        </span>
                                        <span className="imcrm-font-medium imcrm-text-foreground">{money(s.revenue)}</span>
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </Section>
                    {deviceTotal > 0 && (
                        <Section title={__('Dispositivo')}>
                            <BarList
                                testId="shop-stats-devices"
                                rows={withShares(
                                    (Object.keys(DEVICE_LABELS) as Array<keyof ShopStatsDto['devices']>)
                                        .filter((k) => k !== 'tablet' || data.devices.tablet > 0)
                                        .map((k) => ({ key: k, label: __(DEVICE_LABELS[k]), value: data.devices[k], note: widgetRate(data.devices[k], deviceTotal) })),
                                )}
                            />
                        </Section>
                    )}
                </>
            )}
        </>
    );
}

function ProductsTable({ data, money }: { data: ShopStatsDto; money: (n: number) => string }): JSX.Element {
    if (data.products.length === 0) return <p className="imcrm-text-xs imcrm-text-muted-foreground">—</p>;
    return (
        <div className="imcrm-overflow-x-auto imcrm-rounded-lg imcrm-border imcrm-border-border">
            <table className="imcrm-w-full imcrm-text-sm" data-testid="shop-stats-products">
                <thead>
                    <tr className="imcrm-border-b imcrm-border-border imcrm-text-left imcrm-text-[11px] imcrm-text-muted-foreground">
                        <th className="imcrm-px-3 imcrm-py-2 imcrm-font-medium">{__('Producto')}</th>
                        <th className="imcrm-px-3 imcrm-py-2 imcrm-text-right imcrm-font-medium">{__('Lo abrieron')}</th>
                        <th className="imcrm-px-3 imcrm-py-2 imcrm-text-right imcrm-font-medium">{__('Al carrito')}</th>
                        <th className="imcrm-px-3 imcrm-py-2 imcrm-text-right imcrm-font-medium">{__('Vendidas')}</th>
                        <th className="imcrm-px-3 imcrm-py-2 imcrm-text-right imcrm-font-medium">{__('Ventas')}</th>
                    </tr>
                </thead>
                <tbody>
                    {data.products.map((p) => (
                        <tr key={p.id} className="imcrm-border-b imcrm-border-border last:imcrm-border-b-0" data-row={p.id}>
                            <td className="imcrm-max-w-[220px] imcrm-truncate imcrm-px-3 imcrm-py-2" title={p.title || undefined}>
                                {p.title || <span className="imcrm-text-muted-foreground">{__('Un producto que ya no está')}</span>}
                            </td>
                            <td className="imcrm-px-3 imcrm-py-2 imcrm-text-right imcrm-tabular-nums">{formatNumber(p.views)}</td>
                            <td className="imcrm-px-3 imcrm-py-2 imcrm-text-right imcrm-tabular-nums">{formatNumber(p.adds)}</td>
                            <td className="imcrm-px-3 imcrm-py-2 imcrm-text-right imcrm-tabular-nums">{formatNumber(p.units)}</td>
                            <td className="imcrm-whitespace-nowrap imcrm-px-3 imcrm-py-2 imcrm-text-right imcrm-font-medium imcrm-tabular-nums">{money(p.revenue)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/** Visitas (columna clara) y pedidos (columna llena, al frente) por día; las ventas, en el detalle. */
function DailyChart({ data, money }: { data: ShopStatsDto; money: (n: number) => string }): JSX.Element {
    const [hover, setHover] = useState<number | null>(null);
    const days = data.days;
    const max = Math.max(1, ...days.map((d) => Math.max(d.visits, d.orders)));
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
        <div className="imcrm-relative" data-testid="shop-stats-daily">
            <div className="imcrm-mb-1 imcrm-flex imcrm-items-center imcrm-gap-4 imcrm-text-[11px] imcrm-text-muted-foreground">
                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                    <span className="imcrm-inline-block imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-sm imcrm-bg-primary/25" aria-hidden />
                    {__('Visitas')}
                </span>
                <span className="imcrm-flex imcrm-items-center imcrm-gap-1.5">
                    <span className="imcrm-inline-block imcrm-h-2.5 imcrm-w-2.5 imcrm-rounded-sm imcrm-bg-primary" aria-hidden />
                    {__('Pedidos')}
                </span>
            </div>
            <svg viewBox={`0 0 ${W} ${H}`} className="imcrm-h-auto imcrm-w-full imcrm-overflow-visible" role="img" aria-label={__('Visitas y pedidos por día')} onMouseLeave={() => setHover(null)}>
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
                            {d.visits > 0 && <rect x={x} y={y(d.visits)} width={bw} height={pad.t + ih - y(d.visits)} rx={Math.min(3, bw / 2)} className="imcrm-fill-primary/25" />}
                            {d.orders > 0 && <rect x={x + (bw - inner) / 2} y={y(d.orders)} width={inner} height={pad.t + ih - y(d.orders)} rx={Math.min(2, inner / 2)} className="imcrm-fill-primary" />}
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
                    data-testid="shop-stats-tooltip"
                >
                    <p className="imcrm-font-medium imcrm-text-foreground">{formatDateStr(h.day)}</p>
                    <p className="imcrm-text-muted-foreground">
                        {__('Visitas')}: <span className="imcrm-text-foreground">{formatNumber(h.visits)}</span> · {__('Pedidos')}: <span className="imcrm-text-foreground">{formatNumber(h.orders)}</span> ·{' '}
                        {__('Ventas')}: <span className="imcrm-text-foreground">{money(h.revenue)}</span>
                    </p>
                </div>
            )}
        </div>
    );
}
