import { Check, Flag } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary } from '../kit';

/**
 * La lógica del formulario (v0.1.356): la persona escribe su nombre y la
 * pregunta siguiente ya la saluda por él; elige «Persona», la página de la
 * empresa se salta y una flecha la lleva a la página 3; termina en una
 * pantalla final que también la llama por su nombre.
 */

const CSS = `
@keyframes flg-cur{
0%{transform:translate(120px,270px)}
8%,10%{transform:translate(110px,92px)}
28%,31%{transform:translate(69px,155px)}
40%,43%{transform:translate(153px,190px)}
60%{transform:translate(170px,255px)}
94%{transform:translate(170px,255px)}
100%{transform:translate(120px,270px)}}
@keyframes flg-ring{
0%,8%{opacity:0;transform:scale(.4)}9%{opacity:1;transform:scale(1)}13%,29%{opacity:0;transform:scale(1.6)}
30%{opacity:1;transform:scale(1)}34%,41%{opacity:0;transform:scale(1.6)}
42%{opacity:1;transform:scale(1)}46%,100%{opacity:0;transform:scale(1.6)}}
@keyframes flg-type{0%,10%{width:0}20%,94%{width:34px}98%,100%{width:0}}
@keyframes flg-hola{0%,20%{opacity:1}23%,94%{opacity:0}98%,100%{opacity:1}}
@keyframes flg-name{0%,20%{opacity:0}23%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes flg-pick{0%,30%{background:${C.card};box-shadow:0 0 0 1px ${C.border}}32%,94%{background:${primary(0.14)};box-shadow:0 0 0 2px ${primary()}}98%,100%{background:${C.card};box-shadow:0 0 0 1px ${C.border}}}
@keyframes flg-skip{0%,44%{opacity:1}50%,94%{opacity:.38}98%,100%{opacity:1}}
@keyframes flg-tag{0%,46%{opacity:0;transform:translateX(6px)}51%,94%{opacity:1;transform:translateX(0)}98%,100%{opacity:0}}
@keyframes flg-arrow{0%,44%{stroke-dashoffset:100;opacity:0}45%{stroke-dashoffset:100;opacity:1}54%,94%{stroke-dashoffset:0;opacity:1}98%{stroke-dashoffset:0;opacity:0}100%{stroke-dashoffset:100;opacity:0}}
@keyframes flg-p3{0%,53%{box-shadow:0 0 0 1px ${C.border};background:${C.card}}56%,94%{box-shadow:0 0 0 2px ${primary()};background:${primary(0.08)}}98%,100%{box-shadow:0 0 0 1px ${C.border};background:${C.card}}}
@keyframes flg-down{0%,60%{stroke-dashoffset:100;opacity:0}61%{stroke-dashoffset:100;opacity:1}66%,94%{stroke-dashoffset:0;opacity:1}98%{opacity:0}100%{stroke-dashoffset:100;opacity:0}}
@keyframes flg-end{0%,66%{opacity:0;transform:translateY(8px) scale(.97)}71%,94%{opacity:1;transform:translateY(0) scale(1)}98%,100%{opacity:0}}
`;

const CARD = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.35)' } as const;
const CHIP = { borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, padding: '0 10px' } as const;

export default function FormLogic(): JSX.Element {
    return (
        <Stage
            label="La lógica del formulario: la persona escribe su nombre y la pregunta siguiente la saluda por él; elige «Persona», la página de la empresa se salta, pasa directo a la página 3 y termina en una pantalla final que dice «¡Gracias, Laura!»."
            cycle={10}
            tint="violet"
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Página 1: nombre y tipo */}
                <At x={20} y={40} w={180} h={176} style={CARD}>
                    <At x={12} y={11}>
                        <T size={6.5} weight={700} color={C.mutedFg} style={{ letterSpacing: '.06em' }}>
                            PÁGINA 1 DE 3
                        </T>
                    </At>
                    <At x={12} y={27}>
                        <T size={8.5} weight={700}>
                            ¿Cómo te llamas?
                        </T>
                    </At>
                    <At x={12} y={42} w={156} h={20} style={{ borderRadius: 6, boxShadow: `0 0 0 1px ${C.border}`, background: C.card }}>
                        <At x={8} y={4} h={12} a="flg-type" style={{ width: 34, overflow: 'hidden' }}>
                            <T size={8.5}>Laura</T>
                        </At>
                    </At>
                    <At x={12} y={76} a="flg-hola">
                        <T size={8.5} weight={700}>
                            Hola, ¿persona o empresa?
                        </T>
                    </At>
                    <At x={12} y={76} a="flg-name" style={{ opacity: 0 }}>
                        <T size={8.5} weight={700}>
                            <span style={{ color: primary() }}>Laura</span>, ¿persona o empresa?
                        </T>
                    </At>
                    <At
                        x={12}
                        y={104}
                        w={74}
                        h={22}
                        a="flg-pick"
                        style={{ borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: primary(0.14), boxShadow: `0 0 0 2px ${primary()}` }}
                    >
                        <T size={8.5} weight={700}>
                            Persona
                        </T>
                    </At>
                    <At
                        x={92}
                        y={104}
                        w={76}
                        h={22}
                        style={{ borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.card, boxShadow: `0 0 0 1px ${C.border}` }}
                    >
                        <T size={8.5} weight={700}>
                            Empresa
                        </T>
                    </At>
                    <At
                        x={98}
                        y={140}
                        w={70}
                        h={20}
                        style={{ borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', background: primary() }}
                    >
                        <T size={8} weight={700} color="#fff">
                            Siguiente
                        </T>
                    </At>
                </At>

                {/* Las páginas que siguen: la de la empresa se salta */}
                <At x={250} y={50} w={204} h={30} a="flg-skip" style={{ ...CHIP, background: C.card, boxShadow: `0 0 0 1px ${C.border}` }}>
                    <T size={8} weight={700}>
                        Página 2 · Tu empresa
                    </T>
                </At>
                <At x={392} y={57} a="flg-tag" style={{ opacity: 0 }}>
                    <At
                        x={0}
                        y={0}
                        w={54}
                        h={16}
                        style={{ borderRadius: 99, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.muted }}
                    >
                        <T size={6.5} weight={700} color={C.mutedFg}>
                            Se salta
                        </T>
                    </At>
                </At>
                <At x={250} y={104} w={204} h={30} a="flg-p3" style={{ ...CHIP, background: primary(0.08), boxShadow: `0 0 0 2px ${primary()}` }}>
                    <T size={8} weight={700}>
                        Página 3 · Casi listo, <span style={{ color: primary() }}>Laura</span>
                    </T>
                </At>

                <svg width={480} height={300} viewBox="0 0 480 300" style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
                    <defs>
                        <marker id="flg-head" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                            <path d="M 0 0 L 8 4 L 0 8 z" fill={primary()} />
                        </marker>
                    </defs>
                    <path
                        d="M 202 170 C 228 170, 224 119, 247 119"
                        pathLength={100}
                        fill="none"
                        stroke={primary()}
                        strokeWidth={1.8}
                        strokeDasharray={100}
                        markerEnd="url(#flg-head)"
                        data-a=""
                        style={{ animationName: 'flg-arrow', strokeDashoffset: 0 }}
                    />
                    <path
                        d="M 352 136 L 352 157"
                        pathLength={100}
                        fill="none"
                        stroke={primary()}
                        strokeWidth={1.8}
                        strokeDasharray={100}
                        markerEnd="url(#flg-head)"
                        data-a=""
                        style={{ animationName: 'flg-down', strokeDashoffset: 0 }}
                    />
                </svg>

                {/* La pantalla final, con la respuesta recordada */}
                <At x={250} y={162} w={204} h={96} a="flg-end" style={CARD}>
                    <At
                        x={14}
                        y={14}
                        w={26}
                        h={26}
                        style={{ borderRadius: 99, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <Check size={14} color="#fff" strokeWidth={3} />
                    </At>
                    <At x={50} y={16}>
                        <T size={11} weight={800}>
                            ¡Gracias, <span style={{ background: primary(0.14), color: primary(), borderRadius: 4, padding: '0 2px', marginRight: 1 }}>Laura</span>!
                        </T>
                    </At>
                    <At x={50} y={34}>
                        <T size={7.5} color={C.mutedFg}>
                            Te escribimos pronto.
                        </T>
                    </At>
                    <At x={14} y={62} w={176} h={1} style={{ background: C.border }} />
                    <At x={14} y={72} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Flag size={8} color={C.mutedFg} />
                        <T size={6.5} color={C.mutedFg}>
                            Si fuera una empresa grande, vería otro mensaje
                        </T>
                    </At>
                </At>

                <Cursor a="flg-cur" click="flg-ring" rest={[170, 255]} />
            </At>
        </Stage>
    );
}
