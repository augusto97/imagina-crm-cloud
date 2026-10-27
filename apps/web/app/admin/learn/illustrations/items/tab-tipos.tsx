import { TrendingUp } from 'lucide-react';

import { At, C, Keyframes, Stage, T, tone } from '../kit';

/**
 * El catálogo de widgets: cada tipo responde una pregunta distinta (cuánto,
 * cómo va, cuánto falta, cómo se reparte, por dónde se pierden, cómo
 * evoluciona…). Las tarjetas aparecen una a una y su gráfico se dibuja.
 */

type Tn = 'cyan' | 'mint' | 'rose' | 'blue' | 'violet' | 'amber' | 'slate';

const W = 146;
const H = 86;

const CARDS = 9;
const pop = Array.from({ length: CARDS }, (_, i) => {
    const s = 2 + i * 4;
    return `@keyframes tt-pop${i}{0%,${s}%{opacity:0;transform:translateY(8px) scale(.96)}${s + 6}%,92%{opacity:1;transform:translateY(0) scale(1)}97%,100%{opacity:0;transform:translateY(0) scale(1)}}`;
}).join('\n');

const CSS = `
${pop}
@keyframes tt-grow{0%,14%{transform:scaleY(0);opacity:1}30%,92%{transform:scaleY(1);opacity:1}97%,100%{transform:scaleY(1);opacity:0}}
@keyframes tt-growx{0%,26%{transform:scaleX(0);opacity:1}42%,92%{transform:scaleX(1);opacity:1}97%,100%{transform:scaleX(1);opacity:0}}
@keyframes tt-arc{0%,12%{stroke-dashoffset:66}30%,92%{stroke-dashoffset:19}97%,100%{stroke-dashoffset:19}}
@keyframes tt-line{0%,30%{stroke-dashoffset:160}50%,92%{stroke-dashoffset:0}97%,100%{stroke-dashoffset:0}}
@keyframes tt-donut0{0%,18%{stroke-dasharray:0 100}34%,92%{stroke-dasharray:44 100}97%,100%{stroke-dasharray:44 100}}
@keyframes tt-donut1{0%,20%{stroke-dasharray:0 100}36%,92%{stroke-dasharray:31 100}97%,100%{stroke-dasharray:31 100}}
@keyframes tt-donut2{0%,22%{stroke-dasharray:0 100}38%,92%{stroke-dasharray:25 100}97%,100%{stroke-dasharray:25 100}}
@keyframes tt-cell{0%,34%{opacity:0}46%,92%{opacity:1}97%,100%{opacity:0}}
`;

function Card({ i, title, ask, children }: { i: number; title: string; ask: string; children: JSX.Element }): JSX.Element {
    const col = i % 3;
    const row = Math.floor(i / 3);
    return (
        <At
            x={11 + col * (W + 8)}
            y={12 + row * (H + 9)}
            w={W}
            h={H}
            a={`tt-pop${i}`}
            style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                padding: '7px 9px',
                boxShadow: '0 6px 16px -12px rgba(15,23,42,.4)',
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            <T size={9} weight={700}>
                {title}
            </T>
            <T size={7} color={C.mutedFg} style={{ marginTop: 1 }}>
                {ask}
            </T>
            <div style={{ position: 'relative', flex: 1, marginTop: 4 }}>{children}</div>
        </At>
    );
}

function Bars(): JSX.Element {
    const data: Array<[number, Tn]> = [
        [30, 'cyan'],
        [44, 'blue'],
        [24, 'violet'],
        [38, 'mint'],
        [16, 'rose'],
    ];
    return (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: 8, padding: '0 10px', borderBottom: `1px solid ${C.border}` }}>
            {data.map(([h, t], k) => (
                <span
                    key={k}
                    data-a=""
                    style={{ width: 14, height: h, borderRadius: '3px 3px 0 0', background: tone(t), transformOrigin: 'bottom', animationName: 'tt-grow' }}
                />
            ))}
        </div>
    );
}

function Funnel(): JSX.Element {
    const data: Array<[number, Tn]> = [
        [118, 'cyan'],
        [86, 'blue'],
        [56, 'violet'],
        [30, 'mint'],
    ];
    return (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3 }}>
            {data.map(([w, t], k) => (
                <span key={k} data-a="" style={{ width: w, height: 8, borderRadius: 2, background: tone(t), animationName: 'tt-growx' }} />
            ))}
        </div>
    );
}

export default function TabTipos(): JSX.Element {
    return (
        <Stage label="Los tipos de widget, cada uno para una pregunta: KPI, KPI con comparación, medidor, barras, dona, embudo, línea, tabla y tabla dinámica." tint="cyan">
            <Keyframes css={CSS} />
            <div style={{ position: 'absolute', inset: 0, fontSize: 10, lineHeight: 1.25 }}>
                <Card i={0} title="KPI · Número" ask="¿Cuánto llevamos?">
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <T size={17} weight={800}>
                            $ 39,4 M
                        </T>
                        <svg width="120" height="18" viewBox="0 0 120 18" style={{ marginTop: 3 }}>
                            <polyline
                                points="0,15 15,12 30,13 45,8 60,10 75,6 90,7 105,3 120,4"
                                fill="none"
                                stroke={tone('blue')}
                                strokeWidth="1.6"
                                strokeDasharray="160"
                                data-a=""
                                style={{ animationName: 'tt-line' }}
                            />
                        </svg>
                    </div>
                </Card>
                <Card i={1} title="KPI · Delta" ask="¿Vamos mejor que antes?">
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <T size={17} weight={800}>
                                128
                            </T>
                            <span
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 2,
                                    height: 15,
                                    padding: '0 5px',
                                    borderRadius: 99,
                                    background: tone('mint', 0.16),
                                    color: tone('mint'),
                                }}
                            >
                                <TrendingUp size={9} />
                                <T size={7.5} weight={700} color={tone('mint')}>
                                    12 %
                                </T>
                            </span>
                        </span>
                        <T size={7} color={C.mutedFg}>
                            vs 114 en los 30 días previos
                        </T>
                    </div>
                </Card>
                <Card i={2} title="Medidor" ask="¿Cuánto falta para la meta?">
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                        <svg width="76" height="42" viewBox="0 0 76 42">
                            <path d="M 7 38 A 31 31 0 0 1 69 38" fill="none" stroke={C.muted} strokeWidth="8" strokeLinecap="round" />
                            <path
                                d="M 7 38 A 31 31 0 0 1 69 38"
                                fill="none"
                                stroke={tone('amber')}
                                strokeWidth="8"
                                strokeLinecap="round"
                                strokeDasharray="98"
                                strokeDashoffset="19"
                                data-a=""
                                style={{ animationName: 'tt-arc' }}
                            />
                        </svg>
                        <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, textAlign: 'center' }}>
                            <T size={10} weight={800}>
                                80 %
                            </T>
                        </span>
                    </div>
                </Card>
                <Card i={3} title="Barras o columnas" ask="¿Quién lleva más?">
                    <Bars />
                </Card>
                <Card i={4} title="Torta / dona" ask="¿Cómo se reparte?">
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                        <svg width="46" height="46" viewBox="0 0 42 42" style={{ transform: 'rotate(-90deg)' }}>
                            <circle cx="21" cy="21" r="15.9" fill="none" stroke={C.muted} strokeWidth="6" />
                            {(
                                [
                                    ['cyan', 0, 'tt-donut0', 44],
                                    ['amber', -44, 'tt-donut1', 31],
                                    ['violet', -75, 'tt-donut2', 25],
                                ] as Array<[Tn, number, string, number]>
                            ).map(([t, off, a, len]) => (
                                <circle
                                    key={t}
                                    cx="21"
                                    cy="21"
                                    r="15.9"
                                    fill="none"
                                    stroke={tone(t)}
                                    strokeWidth="6"
                                    strokeDasharray={`${len} 100`}
                                    strokeDashoffset={off}
                                    data-a=""
                                    style={{ animationName: a }}
                                />
                            ))}
                        </svg>
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {(
                                [
                                    ['Web', 'cyan'],
                                    ['Referido', 'amber'],
                                    ['Feria', 'violet'],
                                ] as Array<[string, Tn]>
                            ).map(([l, t]) => (
                                <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                                    <span style={{ width: 6, height: 6, borderRadius: 2, background: tone(t) }} />
                                    <T size={7} color={C.mutedFg}>
                                        {l}
                                    </T>
                                </span>
                            ))}
                        </span>
                    </div>
                </Card>
                <Card i={5} title="Embudo" ask="¿Dónde se caen las ventas?">
                    <Funnel />
                </Card>
                <Card i={6} title="Línea / área" ask="¿Cómo evoluciona?">
                    <svg width="128" height="40" viewBox="0 0 128 40" style={{ position: 'absolute', left: 0, bottom: 2 }}>
                        <path d="M0 34 L18 28 L36 30 L54 20 L72 22 L90 12 L108 14 L128 4 L128 40 L0 40 Z" fill={tone('violet', 0.14)} />
                        <path
                            d="M0 34 L18 28 L36 30 L54 20 L72 22 L90 12 L108 14 L128 4"
                            fill="none"
                            stroke={tone('violet')}
                            strokeWidth="2"
                            strokeDasharray="160"
                            data-a=""
                            style={{ animationName: 'tt-line' }}
                        />
                    </svg>
                </Card>
                <Card i={7} title="Tabla · Top N" ask="¿Cuáles son los primeros?">
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4 }}>
                        {(
                            [
                                ['Hotel Brisas', 'Ganado', 'mint', '7,9 M'],
                                ['Clínica Norte', 'Propuesta', 'violet', '4,1 M'],
                                ['Café Bahía', 'Nuevo', 'cyan', '3,6 M'],
                            ] as Array<[string, string, Tn, string]>
                        ).map(([n, s, t, v]) => (
                            <span key={n} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <T size={7.5} weight={600} style={{ width: 52, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {n}
                                </T>
                                <span style={{ display: 'inline-flex', alignItems: 'center', height: 11, padding: '0 4px', borderRadius: 3, background: tone(t), color: '#fff' }}>
                                    <T size={6.5} weight={700} color="#fff">
                                        {s}
                                    </T>
                                </span>
                                <T size={7.5} weight={700} color={C.mutedFg} style={{ marginLeft: 'auto' }}>
                                    {v}
                                </T>
                            </span>
                        ))}
                    </div>
                </Card>
                <Card i={8} title="Tabla dinámica" ask="¿Qué ciudad en qué mes?">
                    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '34px repeat(3, 1fr)', gap: 2, alignContent: 'center' }}>
                        {['', 'Ene', 'Feb', 'Mar'].map((h) => (
                            <T key={h} size={6.5} weight={700} color={C.mutedFg} style={{ textAlign: 'center' }}>
                                {h}
                            </T>
                        ))}
                        {(
                            [
                                ['Bogotá', [0.9, 0.6, 0.75]],
                                ['Medellín', [0.4, 0.8, 0.5]],
                                ['Cali', [0.2, 0.35, 0.6]],
                            ] as Array<[string, number[]]>
                        ).map(([city, vals]) => (
                            <span key={city} style={{ display: 'contents' }}>
                                <T size={6.5} color={C.mutedFg}>
                                    {city}
                                </T>
                                {vals.map((v, k) => (
                                    <span key={k} data-a="" style={{ height: 12, borderRadius: 2, background: tone('blue', v), animationName: 'tt-cell' }} />
                                ))}
                            </span>
                        ))}
                    </div>
                </Card>
            </div>
        </Stage>
    );
}
