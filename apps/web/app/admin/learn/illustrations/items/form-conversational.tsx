import { Check } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary } from '../kit';

/**
 * Una pregunta por pantalla (v0.1.357): empieza con la bienvenida y su
 * «Empezar»; cada respuesta pasa sola a la siguiente pregunta, con su avance.
 */

const CSS = `
@keyframes fcv-cur{
0%{transform:translate(330px,280px)}
10%,15%{transform:translate(240px,226px)}
33%,38%{transform:translate(240px,150px)}
56%,61%{transform:translate(286px,152px)}
75%{transform:translate(330px,268px)}
100%{transform:translate(330px,280px)}}
@keyframes fcv-ring{
0%,13%{opacity:0;transform:scale(.4)}14%{opacity:1;transform:scale(1)}19%,36%{opacity:0;transform:scale(1.6)}
37%{opacity:1;transform:scale(1)}42%,59%{opacity:0;transform:scale(1.6)}
60%{opacity:1;transform:scale(1)}65%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fcv-s1{0%,16%{opacity:1;transform:none}21%,100%{opacity:0;transform:translateY(-14px)}}
@keyframes fcv-s2{0%,18%{opacity:0;transform:translateY(14px)}23%,39%{opacity:1;transform:none}44%,100%{opacity:0;transform:translateY(-14px)}}
@keyframes fcv-s3{0%,41%{opacity:0;transform:translateY(14px)}46%,62%{opacity:1;transform:none}67%,100%{opacity:0;transform:translateY(-14px)}}
@keyframes fcv-s4{0%,64%{opacity:0;transform:translateY(14px) scale(.97)}70%,94%{opacity:1;transform:none}98%,100%{opacity:0}}
@keyframes fcv-pick1{0%,37%{background:${C.card};box-shadow:0 0 0 1px ${C.border}}38%,100%{background:${primary(0.14)};box-shadow:0 0 0 2px ${primary()}}}
@keyframes fcv-pick2{0%,60%{background:${C.card};color:inherit}61%,100%{background:${primary()};color:#fff}}
@keyframes fcv-bar{0%,20%{width:0}24%,42%{width:33%}47%,65%{width:66%}70%,94%{width:100%}98%,100%{width:0}}
`;

const OPT = { borderRadius: 7, display: 'flex', alignItems: 'center', padding: '0 10px', background: C.card, boxShadow: `0 0 0 1px ${C.border}` } as const;

export default function FormConversational(): JSX.Element {
    return (
        <Stage
            label="Un formulario de una pregunta por pantalla: empieza con la bienvenida «Encuesta rápida · Toma 1 minuto» y el botón «Empezar»; elegir una opción pasa sola a la siguiente pregunta, con el avance arriba, hasta el «¡Gracias!»."
            cycle={9}
            tint="blue"
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                <At
                    x={130}
                    y={18}
                    w={220}
                    h={266}
                    style={{ background: C.card, borderRadius: 16, border: `1px solid ${C.border}`, boxShadow: '0 16px 34px -16px rgba(15,23,42,.4)', overflow: 'hidden' }}
                >
                    {/* Avance: «Pregunta X de 3» */}
                    <At x={16} y={14} w={188} h={5} style={{ borderRadius: 99, background: C.muted, overflow: 'hidden' }}>
                        <At x={0} y={0} h={5} a="fcv-bar" style={{ width: 0, background: primary(), borderRadius: 99 }} />
                    </At>

                    {/* 1 · Bienvenida */}
                    <At x={0} y={28} w={220} h={238} a="fcv-s1">
                        <At x={60} y={16} w={100} h={62} style={{ borderRadius: 10, background: `linear-gradient(135deg, ${primary(0.85)}, ${primary(0.45)})` }} />
                        <At x={0} y={92} w={220} style={{ textAlign: 'center' }}>
                            <T size={11} weight={800}>
                                Encuesta rápida
                            </T>
                        </At>
                        <At x={0} y={112} w={220} style={{ textAlign: 'center' }}>
                            <T size={7.5} color={C.mutedFg}>
                                Cuéntanos cómo te fue con nosotros.
                            </T>
                        </At>
                        <At x={0} y={130} w={220} style={{ textAlign: 'center' }}>
                            <T size={7} color={C.mutedFg}>
                                ⏱ Toma 1 minuto
                            </T>
                        </At>
                        <At x={60} y={156} w={100} h={26} style={{ borderRadius: 7, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <T size={8.5} weight={700} color="#fff">
                                Empezar
                            </T>
                        </At>
                    </At>

                    {/* 2 · Primera pregunta */}
                    <At x={0} y={28} w={220} h={238} a="fcv-s2" style={{ opacity: 0 }}>
                        <At x={16} y={6}>
                            <T size={6.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.05em' }}>
                                PREGUNTA 1 DE 3
                            </T>
                        </At>
                        <At x={16} y={24} w={188}>
                            <T size={10} weight={800}>
                                ¿Cómo nos conociste?
                            </T>
                        </At>
                        <At x={16} y={56} w={188} h={26} style={OPT}>
                            <T size={8}>Redes sociales</T>
                        </At>
                        <At x={16} y={88} w={188} h={26} a="fcv-pick1" style={OPT}>
                            <T size={8} weight={600}>
                                Me lo recomendaron
                            </T>
                        </At>
                        <At x={16} y={120} w={188} h={26} style={OPT}>
                            <T size={8}>Buscando en internet</T>
                        </At>
                    </At>

                    {/* 3 · Una escala */}
                    <At x={0} y={28} w={220} h={238} a="fcv-s3" style={{ opacity: 0 }}>
                        <At x={16} y={6}>
                            <T size={6.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.05em' }}>
                                PREGUNTA 2 DE 3
                            </T>
                        </At>
                        <At x={16} y={24} w={188}>
                            <T size={10} weight={800}>
                                ¿Nos recomendarías?
                            </T>
                        </At>
                        {[5, 6, 7, 8, 9, 10].map((n, i) => (
                            <At
                                key={n}
                                x={16 + i * 32}
                                y={60}
                                w={28}
                                h={28}
                                a={n === 9 ? 'fcv-pick2' : undefined}
                                style={{ ...OPT, padding: 0, justifyContent: 'center' }}
                            >
                                <T size={8.5} weight={700} color="inherit">
                                    {n}
                                </T>
                            </At>
                        ))}
                        <At x={16} y={96} w={188} style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <T size={6.5} color={C.mutedFg}>
                                Poco probable
                            </T>
                            <T size={6.5} color={C.mutedFg}>
                                Muy probable
                            </T>
                        </At>
                    </At>

                    {/* 4 · Gracias */}
                    <At x={0} y={28} w={220} h={238} a="fcv-s4" style={{ opacity: 0 }}>
                        <At x={92} y={50} w={36} h={36} style={{ borderRadius: 99, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Check size={18} color="#fff" strokeWidth={3} />
                        </At>
                        <At x={0} y={100} w={220} style={{ textAlign: 'center' }}>
                            <T size={11} weight={800}>
                                ¡Gracias!
                            </T>
                        </At>
                        <At x={0} y={120} w={220} style={{ textAlign: 'center' }}>
                            <T size={7.5} color={C.mutedFg}>
                                Tu respuesta ya llegó.
                            </T>
                        </At>
                    </At>
                </At>

                <Cursor a="fcv-cur" click="fcv-ring" rest={[330, 268]} />
            </At>
        </Stage>
    );
}
