import { ArrowLeftRight, ChevronDown, Lock, PencilLine } from 'lucide-react';

import { IntegrationLogo } from '@/cloud/components/IntegrationLogo';

import { At, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * «El sitio manda»: en una lista que viene de WordPress, el título y el precio
 * se cambian aquí y viajan al sitio (flechas), la fecha de modificación la
 * pone WordPress (candado) y «Responsable» es una columna propia (lápiz).
 */

const CSS = `
@keyframes sl-cur{0%{transform:translate(250px,280px);opacity:0}5%{opacity:1}12%,16%{transform:translate(90px,104px)}38%,44%{transform:translate(300px,104px)}66%,70%{transform:translate(400px,104px)}86%,100%{transform:translate(430px,190px);opacity:0}}
@keyframes sl-ring{0%,13%{opacity:0;transform:scale(.4)}14%{opacity:1;transform:scale(1)}18%{opacity:0;transform:scale(1.6)}40%{opacity:0;transform:scale(.4)}41%{opacity:1;transform:scale(1)}45%{opacity:0;transform:scale(1.6)}67%{opacity:0;transform:scale(.4)}68%{opacity:1;transform:scale(1)}72%,100%{opacity:0;transform:scale(1.6)}}
@keyframes sl-tcell{0%,15%{box-shadow:none;background:transparent}18%,30%{box-shadow:inset 0 0 0 1.5px ${primary()};background:${primary(0.08)}}36%,100%{box-shadow:none;background:transparent}}
@keyframes sl-told{0%,20%{opacity:1}23%,100%{opacity:0}}
@keyframes sl-tnew{0%,20%{opacity:0}23%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes sl-tip{0%,42%{opacity:0;transform:translateY(4px)}46%,60%{opacity:1;transform:translateY(0)}64%,100%{opacity:0}}
@keyframes sl-mcell{0%,42%{background:transparent}45%,60%{background:${C.muted}}64%,100%{background:transparent}}
@keyframes sl-rold{0%,70%{opacity:1}73%,100%{opacity:0}}
@keyframes sl-rnew{0%,70%{opacity:0}73%,92%{opacity:1}97%,100%{opacity:0}}
`;

const COLS = '1.5fr 0.8fr 0.9fr 0.9fr';

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

export default function SitioLock(): JSX.Element {
    return (
        <Stage
            label="Cada columna de una lista del sitio lleva su marca. El título se cambia aquí y viaja a WordPress, la fecha de modificación la pone WordPress y no se edita, y la columna Responsable es propia de la app."
            tint="blue"
        >
            <Keyframes css={CSS} />

            <Win x={16} y={14} w={448} h={184} title="Propiedades">
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 10px', background: primary(0.06), borderBottom: `1px solid ${C.border}` }}>
                    <IntegrationLogo integrationKey="wordpress" size={14} />
                    <T size={8.5} weight={600}>
                        Sincronizada con WordPress · inmobiliaria.co
                    </T>
                    <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 8, color: primary(), fontWeight: 600 }}>
                        ¿Qué puedo cambiar? <ChevronDown size={9} />
                    </span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, height: 24, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    {(
                        [
                            ['Título', 'sync'],
                            ['Precio', 'sync'],
                            ['Modificado', 'lock'],
                            ['Responsable', 'own'],
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
                <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, height: 28, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                    <span data-a="" style={{ animationName: 'sl-tcell', borderRadius: 4, padding: '2px 3px' }}>
                        <Swap a="sl-told" b="sl-tnew" from="Casa Poblado" to="Casa en El Poblado" />
                    </span>
                    <T size={8.5}>$860 M</T>
                    <span data-a="" style={{ animationName: 'sl-mcell', borderRadius: 4, padding: '2px 3px' }}>
                        <T size={8.5} color={C.mutedFg}>
                            hoy 9:40
                        </T>
                    </span>
                    <span style={{ padding: '2px 3px' }}>
                        <Swap a="sl-rold" b="sl-rnew" from="—" to="Laura" />
                    </span>
                </div>
                {[
                    ['Apartamento Laureles', '$420 M', 'ayer', 'Andrés'],
                    ['Local en Envigado', '$310 M', '3 oct', '—'],
                    ['Finca en Rionegro', '$1.200 M', '1 oct', 'Laura'],
                ].map(([n, p, m, r]) => (
                    <div key={n} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 6, height: 26, alignItems: 'center', padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={8.5} weight={600} style={{ padding: '0 3px' }}>
                            {n}
                        </T>
                        <T size={8.5}>{p}</T>
                        <T size={8.5} color={C.mutedFg} style={{ padding: '0 3px' }}>
                            {m}
                        </T>
                        <T size={8.5} style={{ padding: '0 3px' }}>
                            {r}
                        </T>
                    </div>
                ))}
            </Win>

            <At x={210} y={124} w={190} a="sl-tip" style={{ opacity: 0, background: C.fg, color: C.card, borderRadius: 7, padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 5, boxShadow: '0 10px 22px -12px rgba(15,23,42,.6)', zIndex: 5 }}>
                <Lock size={10} />
                <span style={{ fontSize: 8, fontWeight: 600, lineHeight: 1.3 }}>WordPress la actualiza sola cada vez que alguien guarda.</span>
            </At>

            <At x={16} y={220} w={448} style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
                {(
                    [
                        ['lock', 'Viene de WordPress'],
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

            <At x={16} y={258} w={448} style={{ display: 'flex', justifyContent: 'center' }}>
                <T size={8.5} color={C.mutedFg}>
                    Las entradas se crean y se borran en WordPress: aquí llegan solas.
                </T>
            </At>

            <Cursor a="sl-cur" click="sl-ring" />
        </Stage>
    );
}
