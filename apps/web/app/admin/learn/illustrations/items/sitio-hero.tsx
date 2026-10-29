import { ArrowLeftRight, Check, Globe } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, C, Cursor, Flow, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Un sitio WordPress sincronizado: en el sitio se publica una propiedad nueva
 * y llega sola a la lista; desde la lista se cambia un precio (un campo ACF) y
 * el cambio viaja de vuelta a WordPress.
 */

const CSS = `
@keyframes sh-pub{0%,6%{transform:scale(1)}9%{transform:scale(.92)}12%,100%{transform:scale(1)}}
@keyframes sh-flow{0%,12%{opacity:0}18%,40%{opacity:1}46%,100%{opacity:0}}
@keyframes sh-row{0%,20%{opacity:0;transform:translateY(-6px);background:transparent}26%{opacity:1;transform:translateY(0);background:${tone('mint', 0.22)}}44%,92%{opacity:1;background:transparent}97%,100%{opacity:0}}
@keyframes sh-push{0%,20%{transform:translateY(-26px)}26%,92%{transform:translateY(0)}97%,100%{transform:translateY(-26px)}}
@keyframes sh-cell{0%,52%{box-shadow:none;background:transparent}55%,66%{box-shadow:inset 0 0 0 1.5px ${primary()};background:${primary(0.08)}}72%,100%{box-shadow:none;background:transparent}}
@keyframes sh-old{0%,58%{opacity:1}61%,100%{opacity:0}}
@keyframes sh-new{0%,58%{opacity:0}61%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes sh-back{0%,62%{opacity:0}66%,86%{opacity:1}90%,100%{opacity:0}}
@keyframes sh-wold{0%,70%{opacity:1}73%,100%{opacity:0}}
@keyframes sh-wnew{0%,70%{opacity:0}73%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes sh-wp{0%,70%{background:transparent}73%,84%{background:${tone('mint', 0.2)}}90%,100%{background:transparent}}
@keyframes sh-toast{0%,74%{opacity:0;transform:translateY(6px)}79%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes sh-cur{0%{transform:translate(60px,260px);opacity:0}3%{opacity:1}7%,10%{transform:translate(118px,196px)}26%,30%{transform:translate(300px,250px)}50%,58%{transform:translate(404px,92px)}80%,100%{transform:translate(430px,200px);opacity:0}}
@keyframes sh-ring{0%,7%{opacity:0;transform:scale(.4)}8%{opacity:1;transform:scale(1)}12%{opacity:0;transform:scale(1.6)}53%{opacity:0;transform:scale(.4)}54%{opacity:1;transform:scale(1)}58%,100%{opacity:0;transform:scale(1.6)}}
`;

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

const COLS = '1.5fr 0.9fr 0.8fr';

export default function SitioHero(): JSX.Element {
    return (
        <Stage
            label="En el sitio WordPress se publica una propiedad nueva y llega sola a la lista Propiedades de la app. Desde la lista se cambia el precio y el cambio viaja de vuelta a WordPress."
            tint="blue"
        >
            <Keyframes css={CSS} />

            {/* El sitio */}
            <Win
                x={14}
                y={24}
                w={176}
                h={214}
                title={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <IntegrationLogo integrationKey="wordpress" size={14} />
                        inmobiliaria.co
                    </span>
                }
            >
                <div style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <T size={8} color={C.mutedFg} weight={600}>
                        Propiedades
                    </T>
                    {[
                        ['Casa en El Poblado', '$890.000.000', true],
                        ['Apartamento Laureles', '$420.000.000', false],
                        ['Local en Envigado', '$310.000.000', false],
                    ].map(([n, p, first]) => (
                        <span
                            key={String(n)}
                            data-a={first ? '' : undefined}
                            style={{
                                ...(first ? { animationName: 'sh-wp' } : null),
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 2,
                                padding: '5px 6px',
                                borderRadius: 6,
                                border: `1px solid ${C.border}`,
                            }}
                        >
                            <T size={8.5} weight={700}>
                                {n}
                            </T>
                            {first ? (
                                <span style={{ position: 'relative', display: 'block', height: 12 }}>
                                    <span data-a="" style={{ animationName: 'sh-wold', position: 'absolute', inset: 0, opacity: 0 }}>
                                        <T size={7.5} color={C.mutedFg}>
                                            Precio: $890.000.000
                                        </T>
                                    </span>
                                    <span data-a="" style={{ animationName: 'sh-wnew', position: 'absolute', inset: 0 }}>
                                        <T size={7.5} weight={700} color={C.success}>
                                            Precio: $860.000.000
                                        </T>
                                    </span>
                                </span>
                            ) : (
                                <T size={7.5} color={C.mutedFg}>
                                    Precio: {p}
                                </T>
                            )}
                        </span>
                    ))}
                    <span
                        data-a=""
                        style={{
                            animationName: 'sh-pub',
                            alignSelf: 'flex-start',
                            marginTop: 2,
                            height: 20,
                            padding: '0 9px',
                            borderRadius: 5,
                            background: '#2271B1',
                            color: '#fff',
                            fontSize: 8.5,
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                        }}
                    >
                        Publicar
                    </span>
                </div>
            </Win>

            {/* Lo que viaja */}
            <Flow x1={196} y1={120} x2={250} y2={120} a="sh-flow" />
            <At x={196} y={178} w={54} a="sh-back" style={{ opacity: 0, display: 'flex', justifyContent: 'center', color: primary() }}>
                <ArrowLeftRight size={18} />
            </At>

            {/* La lista en la app */}
            <Win x={254} y={24} w={212} h={170} title={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Globe size={11} color={primary()} />Propiedades</span>}>
                <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, height: 22, alignItems: 'center', padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                    {['Título', 'Precio', 'Zona'].map((l) => (
                        <T key={l} size={7.5} weight={700} color={C.mutedFg}>
                            {l}
                        </T>
                    ))}
                </div>
                <div style={{ position: 'relative', overflow: 'hidden', height: 118 }}>
                    <div data-a="" style={{ animationName: 'sh-row', display: 'grid', gridTemplateColumns: COLS, gap: 6, height: 26, alignItems: 'center', padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={8.5} weight={600}>
                            Finca en Rionegro
                        </T>
                        <T size={8.5}>$1.200 M</T>
                        <T size={8.5}>Oriente</T>
                    </div>
                    <div data-a="" style={{ animationName: 'sh-push' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, height: 26, alignItems: 'center', padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                            <T size={8.5} weight={600}>
                                Casa en El Poblado
                            </T>
                            <span data-a="" style={{ animationName: 'sh-cell', borderRadius: 4, padding: '2px 3px' }}>
                                <Swap a="sh-old" b="sh-new" from="$890 M" to="$860 M" />
                            </span>
                            <T size={8.5}>Poblado</T>
                        </div>
                        {[
                            ['Apartamento Laureles', '$420 M', 'Laureles'],
                            ['Local en Envigado', '$310 M', 'Envigado'],
                        ].map(([n, p, z]) => (
                            <div key={n} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, height: 26, alignItems: 'center', padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                                <T size={8.5} weight={600}>
                                    {n}
                                </T>
                                <T size={8.5} style={{ padding: '0 3px' }}>
                                    {p}
                                </T>
                                <T size={8.5}>{z}</T>
                            </div>
                        ))}
                    </div>
                </div>
            </Win>

            {/* Llegó a WordPress */}
            <At
                x={254}
                y={206}
                w={212}
                a="sh-toast"
                style={{
                    opacity: 0,
                    background: C.card,
                    border: `1px solid ${tone('mint', 0.5)}`,
                    borderRadius: 10,
                    padding: '7px 9px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    boxShadow: '0 10px 22px -14px rgba(15,23,42,.5)',
                }}
            >
                <IntegrationLogo integrationKey="wordpress" size={16} />
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                        <Check size={10} color={C.success} />
                        <T size={8.5} weight={700} color={C.success}>
                            Llegó a WordPress
                        </T>
                    </span>
                    <T size={7.5} color={C.mutedFg}>
                        Casa en El Poblado · precio nuevo
                    </T>
                </span>
            </At>

            <At x={14} y={262} w={452} style={{ display: 'flex', justifyContent: 'center' }}>
                <T size={8.5} color={C.mutedFg}>
                    Lo que publicas en el sitio llega solo; lo que cambias aquí viaja de vuelta.
                </T>
            </At>

            <Cursor a="sh-cur" click="sh-ring" />
        </Stage>
    );
}
