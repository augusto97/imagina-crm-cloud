import { ArrowLeftRight, Check, ChevronDown, Lock, PencilLine } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * «La tienda manda»: cada columna de una lista de la tienda lleva su marca.
 * Candado = viene de la tienda (se edita allá); flechas = se cambia aquí y
 * viaja a la tienda; lápiz = columna propia, nunca viaja. Se cambia un precio
 * (llega a WooCommerce), se intenta cambiar el nombre (bloqueado) y se anota un
 * costo en la columna propia.
 */

const CSS = `
@keyframes tl-cur{0%{transform:translate(250px,280px);opacity:0}5%{opacity:1}12%,16%{transform:translate(204px,104px)}38%,44%{transform:translate(92px,104px)}66%,70%{transform:translate(384px,104px)}86%,100%{transform:translate(420px,180px);opacity:0}}
@keyframes tl-ring{0%,13%{opacity:0;transform:scale(.4)}14%{opacity:1;transform:scale(1)}18%{opacity:0;transform:scale(1.6)}40%{opacity:0;transform:scale(.4)}41%{opacity:1;transform:scale(1)}45%{opacity:0;transform:scale(1.6)}67%{opacity:0;transform:scale(.4)}68%{opacity:1;transform:scale(1)}72%,100%{opacity:0;transform:scale(1.6)}}
@keyframes tl-pcell{0%,15%{box-shadow:none;background:transparent}18%,30%{box-shadow:inset 0 0 0 1.5px ${primary()};background:${primary(0.08)}}36%,100%{box-shadow:none;background:transparent}}
@keyframes tl-pold{0%,20%{opacity:1}23%,100%{opacity:0}}
@keyframes tl-pnew{0%,20%{opacity:0}23%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes tl-sent{0%,24%{opacity:0;transform:translateY(6px)}29%,38%{opacity:1;transform:translateY(0)}42%,100%{opacity:0}}
@keyframes tl-tip{0%,42%{opacity:0;transform:translateY(4px)}46%,60%{opacity:1;transform:translateY(0)}64%,100%{opacity:0}}
@keyframes tl-ncell{0%,42%{background:transparent}45%,60%{background:${C.muted}}64%,100%{background:transparent}}
@keyframes tl-cold{0%,70%{opacity:1}73%,100%{opacity:0}}
@keyframes tl-cnew{0%,70%{opacity:0}73%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes tl-own{0%,72%{opacity:0;transform:translateY(6px)}77%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
`;

const COLS = '1.35fr 1fr 0.7fr 0.9fr';

function Mark({ kind }: { kind: 'lock' | 'sync' | 'own' }): JSX.Element {
    if (kind === 'lock') return <Lock size={9} color={C.mutedFg} />;
    if (kind === 'sync') return <ArrowLeftRight size={9} color={primary()} />;
    return <PencilLine size={9} color={tone('mint')} />;
}

function Swap({ a, b, from, to }: { a: string; b: string; from: string; to: string }): JSX.Element {
    return (
        <span style={{ position: 'relative', display: 'block', height: 14 }}>
            <span data-a="" style={{ animationName: a, position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', opacity: 0 }}>
                <T size={8.5}>{from}</T>
            </span>
            <span data-a="" style={{ animationName: b, position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' }}>
                <T size={8.5} weight={700}>
                    {to}
                </T>
            </span>
        </span>
    );
}

export default function TiendaLock(): JSX.Element {
    return (
        <Stage label="Cada columna de una lista de la tienda lleva su marca: candado si viene de la tienda, flechas si se cambia aquí y viaja a la tienda, lápiz si es una columna propia. Se cambia un precio y llega a WooCommerce, el nombre está bloqueado y el costo se anota en una columna propia." tint="violet">
            <Keyframes css={CSS} />

            <Win x={16} y={14} w={448} h={184} title="Productos">
                {/* Banner de la lista */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', background: primary(0.06), borderBottom: `1px solid ${C.border}` }}>
                    <IntegrationLogo integrationKey="woocommerce" size={14} />
                    <T size={8.5} weight={600}>
                        Sincronizada con WooCommerce · cafeaurora.co
                    </T>
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 8, color: primary(), fontWeight: 600 }}>
                        ¿Qué puedo cambiar? <ChevronDown size={9} />
                    </span>
                </div>
                {/* Cabecera */}
                <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, height: 24, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    {(
                        [
                            ['Nombre', 'lock'],
                            ['Precio normal', 'sync'],
                            ['Stock', 'sync'],
                            ['Costo', 'own'],
                        ] as const
                    ).map(([l, k]) => (
                        <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <T size={8} weight={700} color={C.mutedFg}>
                                {l}
                            </T>
                            <Mark kind={k} />
                        </span>
                    ))}
                </div>
                {/* Fila editada */}
                <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, height: 28, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    <span data-a="" style={{ animationName: 'tl-ncell', borderRadius: 4, padding: '2px 3px', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <T size={8.5} weight={600}>
                            Taza Aurora
                        </T>
                    </span>
                    <span data-a="" style={{ animationName: 'tl-pcell', borderRadius: 4, padding: '2px 4px' }}>
                        <Swap a="tl-pold" b="tl-pnew" from="$35.000" to="$38.000" />
                    </span>
                    <T size={8.5}>24</T>
                    <span style={{ padding: '2px 4px' }}>
                        <Swap a="tl-cold" b="tl-cnew" from="—" to="$14.500" />
                    </span>
                </div>
                {[
                    ['Libreta Kraft', '$22.000', '40', '$8.000'],
                    ['Termo Andes', '$64.900', '7', '$31.000'],
                    ['Café de origen 500 g', '$42.000', '58', '$19.000'],
                ].map(([n, p, s, c]) => (
                    <div key={n} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, height: 26, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={8.5} weight={600} style={{ padding: '0 3px' }}>
                            {n}
                        </T>
                        <T size={8.5} style={{ padding: '0 4px' }}>
                            {p}
                        </T>
                        <T size={8.5}>{s}</T>
                        <T size={8.5} style={{ padding: '0 4px' }}>
                            {c}
                        </T>
                    </div>
                ))}
            </Win>

            {/* Tooltip del nombre bloqueado */}
            <At x={30} y={124} w={176} a="tl-tip" style={{ opacity: 0, background: C.fg, color: C.card, borderRadius: 7, padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 5, boxShadow: '0 10px 22px -12px rgba(15,23,42,.6)', zIndex: 5 }}>
                <Lock size={10} />
                <span style={{ fontSize: 8, fontWeight: 600, lineHeight: 1.3 }}>Viene de WooCommerce: se edita allá.</span>
            </At>

            {/* El precio llega a la tienda */}
            <At x={150} y={208} w={180} a="tl-sent" style={{ opacity: 0, background: C.card, border: `1px solid ${tone('mint', 0.5)}`, borderRadius: 10, padding: '7px 9px', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 10px 22px -14px rgba(15,23,42,.5)' }}>
                <IntegrationLogo integrationKey="woocommerce" size={16} />
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: C.success }}>
                        <Check size={10} />
                        <T size={8.5} weight={700} color={C.success}>
                            Llegó a WooCommerce
                        </T>
                    </span>
                    <T size={7.5} color={C.mutedFg}>
                        Taza Aurora · precio $38.000
                    </T>
                </span>
            </At>

            {/* Columna propia */}
            <At x={300} y={208} w={164} a="tl-own" style={{ background: C.card, border: `1px solid ${tone('mint', 0.45)}`, borderRadius: 10, padding: '7px 9px', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 10px 22px -14px rgba(15,23,42,.5)' }}>
                <PencilLine size={13} color={tone('mint')} />
                <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block' }}>
                    Columna propia: se guarda aquí y nunca viaja a la tienda.
                </T>
            </At>

            {/* Leyenda */}
            <At x={16} y={266} w={448} style={{ display: 'flex', gap: 14, justifyContent: 'center' }}>
                {(
                    [
                        ['lock', 'Viene de la tienda'],
                        ['sync', 'Se cambia aquí y viaja'],
                        ['own', 'Columna propia'],
                    ] as const
                ).map(([k, l]) => (
                    <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 9px', borderRadius: 99, background: C.card, border: `1px solid ${C.border}` }}>
                        <Mark kind={k} />
                        <T size={8.5} weight={600}>
                            {l}
                        </T>
                    </span>
                ))}
            </At>

            <Cursor a="tl-cur" click="tl-ring" />
        </Stage>
    );
}
