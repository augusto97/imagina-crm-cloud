import { ArrowRight, ClipboardCheck, Stamp } from 'lucide-react';

import { At, Avatar, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Portada de Aprobaciones: un gasto pasa por dos pasos en orden (el jefe
 * directo; después Gerencia, donde tienen que aprobar todos) y, al aprobarse
 * el último, el registro cambia solo a «Aprobado».
 */

const CSS = `
@keyframes apf-req{0%,4%{opacity:0;transform:translateY(-8px)}9%,94%{opacity:1;transform:translateY(0)}99%,100%{opacity:0}}
@keyframes apf-s1{0%,12%{box-shadow:0 0 0 0 transparent}15%,30%{box-shadow:0 0 0 3px ${tone('amber', 0.45)}}34%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes apf-s2{0%,34%{box-shadow:0 0 0 0 transparent}37%,62%{box-shadow:0 0 0 3px ${tone('amber', 0.45)}}66%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes apf-c1{0%,26%{opacity:0;transform:scale(.4)}30%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes apf-c2{0%,46%{opacity:0;transform:scale(.4)}50%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes apf-c3{0%,56%{opacity:0;transform:scale(.4)}60%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes apf-w1{0%,29%{opacity:1}31%,100%{opacity:0}}
@keyframes apf-w2{0%,59%{opacity:1}61%,100%{opacity:0}}
@keyframes apf-res{0%,64%{opacity:.35;transform:scale(.96)}69%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:.35}}
@keyframes apf-old{0%,72%{opacity:1}76%,96%{opacity:0}100%{opacity:1}}
@keyframes apf-new{0%,72%{opacity:0;transform:scale(.7)}77%,93%{opacity:1;transform:scale(1)}98%,100%{opacity:0}}
`;

const chip = (label: string, t: 'amber' | 'mint' | 'blue' | 'slate'): JSX.Element => (
    <span style={{ height: 16, padding: '0 7px', borderRadius: 5, background: tone(t), color: '#fff', fontSize: 8.6, fontWeight: 600, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>{label}</span>
);

function Check({ a }: { a: string }): JSX.Element {
    return (
        <span data-a="" style={{ position: 'absolute', right: -3, bottom: -3, width: 11, height: 11, borderRadius: 99, background: C.success, color: '#fff', fontSize: 7, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1.5px solid ${C.card}`, animationName: a }}>
            ✓
        </span>
    );
}

function Person({ initials, t, a, wait }: { initials: string; t: 'violet' | 'cyan' | 'rose'; a: string; wait: string }): JSX.Element {
    return (
        <span style={{ position: 'relative', display: 'inline-flex' }}>
            <Avatar initials={initials} t={t} size={22} />
            <span data-a="" style={{ position: 'absolute', right: -3, bottom: -3, width: 11, height: 11, borderRadius: 99, background: tone('amber'), border: `1.5px solid ${C.card}`, opacity: 0, animationName: wait }} />
            <Check a={a} />
        </span>
    );
}

function StepBox({ x, n, name, mode, a, children }: { x: number; n: number; name: string; mode: string; a: string; children: JSX.Element }): JSX.Element {
    return (
        <At x={x} y={110} w={128} h={84} a={a} style={{ borderRadius: 11, background: C.card, border: `1px solid ${C.border}`, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5, boxShadow: '0 8px 22px -14px rgba(15,23,42,.45)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 16, height: 16, borderRadius: 99, background: primary(0.14), color: primary(), fontSize: 8.4, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
                <T size={9} weight={700}>
                    {name}
                </T>
            </span>
            <T size={7.4} color={C.mutedFg}>
                {mode}
            </T>
            <span style={{ display: 'flex', gap: 6 }}>{children}</span>
        </At>
    );
}

export default function AprobFlujo(): JSX.Element {
    return (
        <Stage label="Un flujo de aprobación de dos pasos: el gasto lo aprueba primero el jefe directo y después Gerencia, donde tienen que aprobar todos; al aprobarse el último paso el registro cambia solo a Aprobado." tint="amber">
            <Keyframes css={CSS} />
            {/* La solicitud */}
            <At x={110} y={18} w={260} h={60} a="apf-req" style={{ borderRadius: 12, background: C.card, border: `1px solid ${C.border}`, padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 10, boxShadow: '0 10px 26px -16px rgba(15,23,42,.5)' }}>
                <span style={{ width: 32, height: 32, borderRadius: 9, background: tone('amber'), color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Stamp size={16} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                    <T size={7} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                        Solicitud · Gasto mayor a $ 1M
                    </T>
                    <T size={10} weight={700}>
                        Viaje a Medellín · $ 2.400.000
                    </T>
                    <T size={7.6} color={C.mutedFg}>
                        Lo pidió Carlos Ruiz
                    </T>
                </span>
            </At>

            <StepBox x={20} n={1} name="Jefe directo" mode="Cualquiera aprueba" a="apf-s1">
                <Person initials="AM" t="violet" a="apf-c1" wait="apf-w1" />
            </StepBox>
            <At x={152} y={144} style={{ color: C.mutedFg }}>
                <ArrowRight size={14} />
            </At>
            <StepBox x={172} n={2} name="Gerencia" mode="Todos aprueban" a="apf-s2">
                <>
                    <Person initials="JP" t="cyan" a="apf-c2" wait="apf-w2" />
                    <Person initials="LG" t="rose" a="apf-c3" wait="apf-w2" />
                </>
            </StepBox>
            <At x={304} y={144} style={{ color: C.mutedFg }}>
                <ArrowRight size={14} />
            </At>
            <At x={324} y={110} w={136} h={84} a="apf-res" style={{ borderRadius: 11, background: tone('mint', 0.1), border: `1px solid ${tone('mint', 0.4)}`, padding: '8px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <span style={{ width: 28, height: 28, borderRadius: 99, background: C.success, color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ClipboardCheck size={15} />
                </span>
                <T size={10} weight={700} color={tone('mint')}>
                    Aprobada
                </T>
                <T size={7.4} color={C.mutedFg}>
                    Se avisa a quien la pidió
                </T>
            </At>

            {/* El registro */}
            <At x={20} y={222} w={440} h={52} style={{ borderRadius: 11, background: C.card, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 14, padding: '0 14px' }}>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                    <T size={9.4} weight={700}>
                        Viaje a Medellín
                    </T>
                    <T size={7.4} color={C.mutedFg}>
                        Gastos · Carlos Ruiz
                    </T>
                </span>
                {[
                    ['Aprobación', chip('Pendiente', 'amber'), chip('Aprobada', 'mint')],
                    ['Estado', chip('En revisión', 'blue'), chip('Aprobado', 'mint')],
                ].map(([label, before, after]) => (
                    <span key={label as string} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={7.2} color={C.mutedFg}>
                            {label}
                        </T>
                        <span style={{ position: 'relative', display: 'block', width: 72, height: 16 }}>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', opacity: 0, animationName: 'apf-old' }}>
                                {before}
                            </span>
                            <span data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', animationName: 'apf-new' }}>
                                {after}
                            </span>
                        </span>
                    </span>
                ))}
            </At>
        </Stage>
    );
}
