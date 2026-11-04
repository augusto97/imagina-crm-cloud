import { Check } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary } from '../kit';

/**
 * Puntaje del formulario (v0.1.357): cada respuesta suma sus puntos al
 * cálculo y, al terminar, la pantalla final muestra el resultado.
 */

const CSS = `
@keyframes fsc-cur{
0%{transform:translate(250px,280px)}
9%,13%{transform:translate(150px,147px)}
32%,37%{transform:translate(88px,216px)}
50%{transform:translate(240px,270px)}
94%{transform:translate(240px,270px)}
100%{transform:translate(250px,280px)}}
@keyframes fsc-ring{
0%,11%{opacity:0;transform:scale(.4)}12%{opacity:1;transform:scale(1)}17%,35%{opacity:0;transform:scale(1.6)}
36%{opacity:1;transform:scale(1)}40%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fsc-o3{0%,12%{background:${C.card};box-shadow:0 0 0 1px ${C.border}}13%,94%{background:${primary(0.12)};box-shadow:0 0 0 2px ${primary()}}98%,100%{background:${C.card};box-shadow:0 0 0 1px ${C.border}}}
@keyframes fsc-yes{0%,36%{background:${C.card};box-shadow:0 0 0 1px ${C.border}}37%,94%{background:${primary(0.12)};box-shadow:0 0 0 2px ${primary()}}98%,100%{background:${C.card};box-shadow:0 0 0 1px ${C.border}}}
@keyframes fsc-p1{0%,13%{opacity:0;transform:translate(0,0) scale(.8)}15%{opacity:1;transform:translate(0,0) scale(1)}26%{opacity:1;transform:translate(180px,-78px) scale(1)}29%,100%{opacity:0;transform:translate(180px,-78px) scale(.8)}}
@keyframes fsc-p2{0%,37%{opacity:0;transform:translate(0,0) scale(.8)}39%{opacity:1;transform:translate(0,0) scale(1)}50%{opacity:1;transform:translate(240px,-152px) scale(1)}53%,100%{opacity:0;transform:translate(240px,-152px) scale(.8)}}
@keyframes fsc-n0{0%,26%{opacity:1}28%,96%{opacity:0}99%,100%{opacity:1}}
@keyframes fsc-n5{0%,26%{opacity:0;transform:translateY(6px)}28%,50%{opacity:1;transform:none}52%,100%{opacity:0}}
@keyframes fsc-n8{0%,50%{opacity:0;transform:translateY(6px)}52%,94%{opacity:1;transform:none}98%,100%{opacity:0}}
@keyframes fsc-bump{0%,26%,32%,50%,56%,100%{transform:scale(1)}28%,52%{transform:scale(1.08)}}
@keyframes fsc-end{0%,58%{opacity:0;transform:translateY(10px) scale(.97)}64%,94%{opacity:1;transform:none}98%,100%{opacity:0}}
@keyframes fsc-bar{0%,26%{width:0}28%,50%{width:50%}52%,94%{width:80%}98%,100%{width:0}}
`;

const CARD = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.35)' } as const;
const OPT = { borderRadius: 6, display: 'flex', alignItems: 'center', padding: '0 10px', background: C.card, boxShadow: `0 0 0 1px ${C.border}` } as const;

export default function FormScore(): JSX.Element {
    return (
        <Stage
            label="El puntaje del formulario: al elegir «3 o más» suma 5 puntos y al elegir «Sí» suma 3; el puntaje sube de 0 a 8 y la pantalla final dice «¡Excelente! Sacaste 8 puntos»."
            cycle={10}
            tint="mint"
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                <At x={20} y={30} w={250} h={236} style={CARD}>
                    <At x={14} y={14}>
                        <T size={8.5} weight={700}>
                            ¿Cuántas veces entrenas por semana?
                        </T>
                    </At>
                    <At x={14} y={36} w={222} h={24} style={OPT}>
                        <T size={8}>Nunca</T>
                    </At>
                    <At x={14} y={66} w={222} h={24} style={OPT}>
                        <T size={8}>1 o 2</T>
                    </At>
                    <At x={14} y={96} w={222} h={24} a="fsc-o3" style={OPT}>
                        <T size={8} weight={600}>
                            3 o más
                        </T>
                    </At>
                    <At x={14} y={140}>
                        <T size={8.5} weight={700}>
                            ¿Duermes 7 horas o más?
                        </T>
                    </At>
                    <At x={14} y={164} w={105} h={30} a="fsc-yes" style={{ ...OPT, justifyContent: 'center' }}>
                        <T size={8.5} weight={600}>
                            Sí
                        </T>
                    </At>
                    <At x={127} y={164} w={109} h={30} style={{ ...OPT, justifyContent: 'center' }}>
                        <T size={8.5} weight={600}>
                            No
                        </T>
                    </At>
                </At>

                {/* Los puntos que suma cada respuesta, volando al puntaje */}
                <At x={196} y={130} a="fsc-p1" style={{ opacity: 0 }}>
                    <At x={0} y={0} w={30} h={18} style={{ borderRadius: 99, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={8} weight={800} color="#fff">
                            +5
                        </T>
                    </At>
                </At>
                <At x={136} y={204} a="fsc-p2" style={{ opacity: 0 }}>
                    <At x={0} y={0} w={30} h={18} style={{ borderRadius: 99, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={8} weight={800} color="#fff">
                            +3
                        </T>
                    </At>
                </At>

                {/* El puntaje que va sumando */}
                <At x={300} y={30} w={160} h={72} a="fsc-bump" style={CARD}>
                    <At x={14} y={12}>
                        <T size={6.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                            PUNTAJE
                        </T>
                    </At>
                    <At x={14} y={24} a="fsc-n0">
                        <T size={22} weight={800}>
                            0
                        </T>
                    </At>
                    <At x={14} y={24} a="fsc-n5" style={{ opacity: 0 }}>
                        <T size={22} weight={800} color={primary()}>
                            5
                        </T>
                    </At>
                    <At x={14} y={24} a="fsc-n8" style={{ opacity: 0 }}>
                        <T size={22} weight={800} color={primary()}>
                            8
                        </T>
                    </At>
                    <At x={14} y={58} w={132} h={5} style={{ borderRadius: 99, background: C.muted, overflow: 'hidden' }}>
                        <At x={0} y={0} h={5} a="fsc-bar" style={{ width: 0, background: primary(), borderRadius: 99 }} />
                    </At>
                </At>

                {/* La pantalla final, con el resultado */}
                <At x={300} y={122} w={160} h={110} a="fsc-end" style={CARD}>
                    <At x={14} y={14} w={26} h={26} style={{ borderRadius: 99, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Check size={14} color="#fff" strokeWidth={3} />
                    </At>
                    <At x={14} y={50}>
                        <T size={10.5} weight={800}>
                            ¡Excelente!
                        </T>
                    </At>
                    <At x={14} y={68}>
                        <T size={8}>
                            Sacaste <span style={{ background: primary(0.14), color: primary(), borderRadius: 4, padding: '0 3px', fontWeight: 700 }}>8</span> puntos
                        </T>
                    </At>
                    <At x={14} y={86}>
                        <T size={6.5} color={C.mutedFg}>
                            Más de 7 · pantalla «Excelente»
                        </T>
                    </At>
                </At>

                <Cursor a="fsc-cur" click="fsc-ring" rest={[240, 270]} />
            </At>
        </Stage>
    );
}
