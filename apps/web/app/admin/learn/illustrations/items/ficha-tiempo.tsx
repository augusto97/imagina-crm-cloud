import { Clock, Play, Plus, Square, Timer } from 'lucide-react';

import { At, Avatar, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** Registro de tiempo: el cronómetro corre (también en la barra de arriba); al detenerlo queda una entrada y el total sube. */

const CSS = `
@keyframes ft-start{0%,16%{opacity:1}18%,74%{opacity:0}76%,100%{opacity:1}}
@keyframes ft-stop{0%,16%{opacity:0}18%,74%{opacity:1}76%,100%{opacity:0}}
@keyframes ft-chip{0%,16%{opacity:0;transform:translateY(-6px)}19%,74%{opacity:1;transform:translateY(0)}77%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes ft-d1{0%,17%{opacity:0}18%,33%{opacity:1}34%,100%{opacity:0}}
@keyframes ft-d2{0%,33%{opacity:0}34%,51%{opacity:1}52%,100%{opacity:0}}
@keyframes ft-d3{0%,51%{opacity:0}52%,75%{opacity:1}76%,100%{opacity:0}}
@keyframes ft-pulse{0%,17%{opacity:0}18%,74%{opacity:1}75%,100%{opacity:0}}
@keyframes ft-entry{0%,76%{opacity:0;height:0}80%,94%{opacity:1;height:30px}99%,100%{opacity:0;height:0}}
@keyframes ft-tot1{0%,77%{opacity:1}79%,100%{opacity:0}}
@keyframes ft-tot2{0%,77%{opacity:0}79%,95%{opacity:1}99%,100%{opacity:0}}
@keyframes ft-cur{0%{transform:translate(160px,290px);opacity:0}5%{opacity:1}12%,16%{transform:translate(70px,167px)}36%{transform:translate(330px,250px)}66%,72%{transform:translate(70px,167px);opacity:1}86%,92%{transform:translate(380px,262px);opacity:1}97%,100%{opacity:0}}
@keyframes ft-ring{0%,14%{opacity:0;transform:scale(.4)}15%{opacity:1;transform:scale(1)}18%,70%{opacity:0;transform:scale(1.6)}71%{opacity:1;transform:scale(1)}74%,100%{opacity:0;transform:scale(1.6)}}
`;

const RUN = [
    ['ft-d1', '0:00:04'],
    ['ft-d2', '0:47:12'],
    ['ft-d3', '1:25:03'],
] as const;

function Entry({ ini, t, who, when, dur, note }: { ini: string; t: 'violet' | 'amber'; who: string; when: string; dur: string; note: string }): JSX.Element {
    return (
        <span style={{ display: 'flex', alignItems: 'center', gap: 7, height: 30, borderBottom: `1px solid ${C.border}` }}>
            <Avatar initials={ini} t={t} size={18} />
            <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <T size={9} weight={600}>
                    {who} · <span style={{ color: C.mutedFg, fontWeight: 500 }}>{when}</span>
                </T>
                <T size={8} color={C.mutedFg} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {note}
                </T>
            </span>
            <T size={10} weight={700}>
                {dur}
            </T>
        </span>
    );
}

export default function FichaTiempo(): JSX.Element {
    return (
        <Stage label="En la ficha de la tarea «Diseño del logo», al tocar «Iniciar cronómetro» empieza a correr el tiempo y aparece un chip con el cronómetro en la barra superior; al tocar «Detener» queda una entrada de 1 h 25 m y el tiempo registrado sube de 3 h 10 m a 4 h 35 m." tint="cyan">
            <Keyframes css={CSS} />
            {/* La barra superior de la app */}
            <At x={20} y={10} w={440} h={28} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, display: 'flex', alignItems: 'center', padding: '0 10px', gap: 8 }}>
                <span style={{ width: 70, height: 7, borderRadius: 99, background: C.muted }} />
                <span style={{ flex: 1 }} />
                <span data-a="" style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '2px 8px', borderRadius: 99, background: tone('rose', 0.14), color: tone('rose'), opacity: 0, animationName: 'ft-chip' }}>
                    <span data-a="" style={{ width: 6, height: 6, borderRadius: 99, background: tone('rose'), animationName: 'ft-pulse' }} />
                    <T size={8.5} weight={700} color={tone('rose')}>
                        Diseño del logo
                    </T>
                    <span style={{ position: 'relative', width: 40, height: 11 }}>
                        {RUN.map(([a, v]) => (
                            <span key={a} data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', opacity: 0, animationName: a }}>
                                <T size={8.5} weight={700} color={tone('rose')} style={{ fontVariantNumeric: 'tabular-nums' }}>
                                    {v}
                                </T>
                            </span>
                        ))}
                    </span>
                    <Square size={8} fill="currentColor" />
                </span>
                <Avatar initials="AM" t="violet" size={18} />
            </At>

            <Win x={20} y={46} w={300} h={248} title="Diseño / Diseño del logo">
                <At x={12} y={10} w={276} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Timer size={12} color={primary()} />
                    <T size={10.5} weight={700}>
                        Registro de tiempo
                    </T>
                    <span style={{ flex: 1 }} />
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, color: C.mutedFg }}>
                        <Plus size={9} />
                        <T size={8.5} weight={600} color={C.mutedFg}>
                            Registrar tiempo
                        </T>
                    </span>
                </At>
                <At x={12} y={34} w={276} h={40} style={{ border: `1px solid ${C.border}`, borderRadius: 9, display: 'flex', alignItems: 'center', padding: '0 10px', gap: 10 }}>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <T size={7.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.05em' }}>
                            TIEMPO REGISTRADO
                        </T>
                        <span style={{ position: 'relative', height: 16, width: 70 }}>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', animationName: 'ft-tot1', opacity: 0 }}>
                                <T size={13} weight={800}>
                                    3h 10m
                                </T>
                            </span>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', animationName: 'ft-tot2' }}>
                                <T size={13} weight={800} color={tone('mint')}>
                                    4h 35m
                                </T>
                            </span>
                        </span>
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Clock size={9} color={C.mutedFg} />
                        <T size={8} color={C.mutedFg}>
                            Por persona: AM 2h 35m · JP 2h
                        </T>
                    </span>
                </At>

                {/* Iniciar / Detener */}
                <At x={12} y={82} w={276} h={28}>
                    <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px', borderRadius: 7, background: primary(), color: C.primaryFg, fontSize: 9.5, fontWeight: 600, animationName: 'ft-start' }}>
                        <Play size={10} fill="currentColor" />
                        Iniciar cronómetro
                    </span>
                    <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', alignItems: 'center', gap: 8, opacity: 0, animationName: 'ft-stop' }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 5, height: 26, padding: '0 10px', borderRadius: 7, background: tone('rose'), color: '#fff', fontSize: 9.5, fontWeight: 600 }}>
                            <Square size={9} fill="currentColor" />
                            Detener
                        </span>
                        <span style={{ position: 'relative', width: 90, height: 12 }}>
                            {RUN.map(([a, v]) => (
                                <span key={a} data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', opacity: 0, animationName: a }}>
                                    <T size={9} weight={600} color={tone('rose')} style={{ fontVariantNumeric: 'tabular-nums' }}>
                                        en curso · {v}
                                    </T>
                                </span>
                            ))}
                        </span>
                    </span>
                </At>

                <At x={12} y={118} w={276} style={{ display: 'flex', flexDirection: 'column' }}>
                    <div data-a="" style={{ overflow: 'hidden', height: 30, animationName: 'ft-entry' }}>
                        <span style={{ display: 'block', background: tone('mint', 0.1), borderRadius: 6 }}>
                            <Entry ini="AM" t="violet" who="Ana Martínez" when="Hoy" dur="1h 25m" note="Versiones finales del logo" />
                        </span>
                    </div>
                    <Entry ini="AM" t="violet" who="Ana Martínez" when="24/10" dur="1h 10m" note="Ajustes de color" />
                    <Entry ini="JP" t="amber" who="Juan Pérez" when="23/10" dur="2h" note="Bocetos iniciales" />
                </At>
            </Win>
            <Win x={332} y={96} w={136} h={128} title="Diseño · Tabla">
                <At x={8} y={6} w={120} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <T size={7.5} weight={700} color={C.mutedFg}>
                        Tarea
                    </T>
                    <T size={7.5} weight={700} color={C.mutedFg}>
                        Tiempo
                    </T>
                </At>
                {(
                    [
                        ['Diseño del logo', ''],
                        ['Tarjetas', '45m'],
                        ['Manual de marca', '6h 20m'],
                    ] as const
                ).map(([n, v], i) => (
                    <At key={n} x={8} y={22 + i * 24} w={120} h={24} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: `1px solid ${C.border}` }}>
                        <T size={8.5} weight={600}>
                            {n}
                        </T>
                        {i === 0 ? (
                            <span style={{ position: 'relative', width: 36, height: 11 }}>
                                <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', animationName: 'ft-tot1', opacity: 0 }}>
                                    <T size={8.5}>3h 10m</T>
                                </span>
                                <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', animationName: 'ft-tot2' }}>
                                    <T size={8.5} weight={700} color={tone('mint')}>
                                        4h 35m
                                    </T>
                                </span>
                            </span>
                        ) : (
                            <T size={8.5}>{v}</T>
                        )}
                    </At>
                ))}
            </Win>
            <Cursor a="ft-cur" click="ft-ring" rest={[380, 262]} />
        </Stage>
    );
}
