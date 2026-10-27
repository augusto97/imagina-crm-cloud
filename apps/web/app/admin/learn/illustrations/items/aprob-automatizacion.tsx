import { ClipboardCheck, FileText, Filter, GitBranch, Hourglass, Mail, Sparkles, Stamp } from 'lucide-react';

import { At, Avatar, C, IconSquare, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Aprobaciones dentro de una automatización: al crear un gasto grande se pide
 * la aprobación, la corrida queda esperando la decisión y, según el resultado,
 * sigue por la rama «Sí» (aprobada) o «No».
 */

const CSS = `
@keyframes apa-dot{0%,6%{opacity:0;transform:translate(0,0)}8%{opacity:1;transform:translate(0,0)}14%{opacity:1;transform:translate(0,10px)}15%,17%{opacity:0;transform:translate(0,10px)}18%{opacity:1;transform:translate(0,46px)}22%{opacity:1;transform:translate(0,56px)}23%,25%{opacity:0;transform:translate(0,56px)}26%{opacity:1;transform:translate(0,92px)}30%{opacity:1;transform:translate(0,102px)}31%,62%{opacity:0;transform:translate(0,102px)}63%{opacity:1;transform:translate(0,138px)}67%{opacity:1;transform:translate(0,148px)}68%,70%{opacity:0;transform:translate(0,148px)}71%{opacity:1;transform:translate(0,184px)}77%{opacity:1;transform:translate(-92px,206px)}78%,100%{opacity:0;transform:translate(-92px,206px)}}
@keyframes apa-wait{0%,30%{opacity:0;transform:scale(.8)}34%,60%{opacity:1;transform:scale(1)}64%,100%{opacity:0;transform:scale(.8)}}
@keyframes apa-hg{0%,32%{transform:rotate(0)}46%{transform:rotate(180deg)}60%,100%{transform:rotate(360deg)}}
@keyframes apa-ok{0%,54%{opacity:0;transform:translateX(14px)}59%,90%{opacity:1;transform:translateX(0)}95%,100%{opacity:0}}
@keyframes apa-yes{0%,76%{box-shadow:0 0 0 0 transparent}79%,90%{box-shadow:0 0 0 3px ${tone('mint', 0.45)}}96%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes apa-hl{0%,32%{box-shadow:0 0 0 0 transparent}35%,60%{box-shadow:0 0 0 3px ${tone('amber', 0.4)}}64%,100%{box-shadow:0 0 0 0 transparent}}
`;

const W = 190;
const X = 145;

function Node({ x = X, y, kicker, title, icon, t, a, w = W }: { x?: number; y: number; kicker: string; title: string; icon: JSX.Element; t: 'amber' | 'blue' | 'violet' | 'mint' | 'rose' | 'slate' | 'cyan'; a?: string; w?: number }): JSX.Element {
    return (
        <At x={x} y={y} w={w} h={36} a={a} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 9, display: 'flex', alignItems: 'center', gap: 7, padding: '0 9px', boxShadow: '0 6px 16px -12px rgba(15,23,42,.45)' }}>
            <IconSquare t={t} size={21}>
                {icon}
            </IconSquare>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <T size={6.8} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {kicker}
                </T>
                <T size={8.6} weight={600}>
                    {title}
                </T>
            </span>
        </At>
    );
}

const line = (y1: number, y2: number): JSX.Element => <At x={X + W / 2 - 1} y={y1} w={2} h={y2 - y1} style={{ background: C.border }} />;

export default function AprobAutomatizacion(): JSX.Element {
    return (
        <Stage label="Una automatización con aprobación: al crear un gasto mayor a un millón se pide la aprobación, la corrida espera la decisión y, como se aprueba, sigue por la rama Sí y genera el comprobante." tint="amber">
            <Keyframes css={CSS} />
            {line(48, 58)}
            {line(94, 104)}
            {line(140, 150)}
            {line(186, 196)}
            <Node y={12} kicker="Cuando" title="Se crea un gasto" icon={<Sparkles size={11} />} t="blue" />
            <Node y={58} kicker="Condición" title="Monto mayor a $ 1.000.000" icon={<Filter size={11} />} t="violet" />
            <Node y={104} kicker="Pedir aprobación" title="Flujo «Gasto mayor a $ 1M»" icon={<Stamp size={11} />} t="amber" />
            <Node y={150} kicker="Esperar aprobación" title="Hasta 5 días; si no, «vencida»" icon={<ClipboardCheck size={11} />} t="amber" a="apa-hl" />
            <Node y={196} kicker="Si / Si no" title="Resultado es «Aprobada»" icon={<GitBranch size={11} />} t="slate" />
            <svg width={480} height={300} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
                <path d={`M ${X + W / 2} 232 C ${X + W / 2} 244, 148 238, 148 252`} fill="none" stroke={tone('mint', 0.7)} strokeWidth="1.6" />
                <path d={`M ${X + W / 2} 232 C ${X + W / 2} 244, 332 238, 332 252`} fill="none" stroke={tone('rose', 0.6)} strokeWidth="1.6" />
            </svg>
            <Node x={58} y={252} w={180} kicker="Sí · Generar un PDF" title="Comprobante de aprobación" icon={<FileText size={11} />} t="mint" a="apa-yes" />
            <Node x={244} y={252} w={180} kicker="No · Enviar email" title="Motivo: {{aprobacion.motivo}}" icon={<Mail size={11} />} t="rose" />

            {/* En espera */}
            <At x={346} y={154} a="apa-wait" style={{ opacity: 0, display: 'flex', alignItems: 'center', gap: 5, height: 26, padding: '0 9px', borderRadius: 99, background: tone('amber', 0.14), border: `1px solid ${tone('amber', 0.4)}` }}>
                <span data-a="" style={{ display: 'flex', animationName: 'apa-hg', color: tone('amber') }}>
                    <Hourglass size={12} />
                </span>
                <T size={8.2} weight={700} color={tone('amber')}>
                    En espera
                </T>
            </At>
            {/* La decisión llega */}
            <At x={346} y={100} w={124} a="apa-ok" style={{ opacity: 0, borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 12px 26px -14px rgba(15,23,42,.5)', padding: '7px 9px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Avatar initials="AM" t="violet" size={20} />
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <T size={8.2} weight={700}>
                        Ana aprobó
                    </T>
                    <T size={7.2} color={C.mutedFg}>
                        y sigue la corrida
                    </T>
                </span>
            </At>
            <At x={14} y={14} w={118} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <T size={9.4} weight={700} color={primary()}>
                    Aprobar gastos grandes
                </T>
                <T size={7.4} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>
                    Usa {'{{aprobacion.resultado}}'}, {'{{aprobacion.decidio}}'} y {'{{aprobacion.motivo}}'} en los pasos de después.
                </T>
            </At>
            <At x={X + W / 2 - 4} y={44} a="apa-dot" style={{ opacity: 0, zIndex: 6 }}>
                <span style={{ display: 'block', width: 8, height: 8, borderRadius: 99, background: primary(), boxShadow: `0 0 0 4px ${primary(0.2)}` }} />
            </At>
        </Stage>
    );
}
