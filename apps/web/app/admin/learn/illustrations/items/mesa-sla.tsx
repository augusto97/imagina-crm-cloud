import { BellRing, Moon, Pause, Timer, TriangleAlert } from 'lucide-react';

import { At, Avatar, C, Keyframes, Stage, T, tone } from '../kit';

/**
 * El reloj del SLA: corre sólo en horario hábil (de noche no cuenta), se
 * detiene mientras el ticket espera al cliente, avisa «en riesgo» al 75% del
 * tiempo y, si se vence, escala.
 */

const BAR_X = 40;
const BAR_W = 400;

const CSS = `
@keyframes ms-fill{0%,4%{width:0}20%{width:${BAR_W * 0.25}px}34%{width:${BAR_W * 0.25}px}44%{width:${BAR_W * 0.5}px}56%{width:${BAR_W * 0.5}px}66%{width:${BAR_W * 0.75}px}84%,100%{width:${BAR_W}px}}
@keyframes ms-col{0%,64%{background:${tone('mint')}}67%,82%{background:${tone('amber')}}85%,100%{background:hsl(var(--imcrm-destructive))}}
@keyframes ms-night{0%,19%{opacity:0;transform:translateY(4px)}22%,33%{opacity:1;transform:translateY(0)}36%,100%{opacity:0}}
@keyframes ms-risk{0%,65%{opacity:0;transform:translateY(6px)}69%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ms-late{0%,85%{opacity:0;transform:translateY(6px)}89%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ms-pause{0%,43%{opacity:0;transform:translateY(4px)}46%,55%{opacity:1;transform:translateY(0)}58%,100%{opacity:0}}
@keyframes ms-status1{0%,62%{opacity:1}64%,100%{opacity:0}}
@keyframes ms-status2{0%,62%{opacity:0}64%,84%{opacity:1}86%,100%{opacity:0}}
@keyframes ms-status3{0%,84%{opacity:0}86%,92%{opacity:1}97%,100%{opacity:0}}
`;

export default function MesaSla(): JSX.Element {
    return (
        <Stage label="El reloj del SLA corre sólo en horario hábil, se detiene mientras el ticket espera al cliente, avisa en riesgo al 75 por ciento del tiempo y escala si se vence." tint="amber">
            <Keyframes css={CSS} />

            {/* Encabezado: el ticket y su objetivo */}
            <At x={24} y={20} w={432} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 26, height: 26, borderRadius: 7, background: tone('amber', 0.16), color: tone('amber'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Timer size={14} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                    <T size={10.5} weight={700}>
                        TCK-0042 · Prioridad alta
                    </T>
                    <T size={8.5} color={C.mutedFg}>
                        Resolución: 8 horas hábiles · lunes a viernes, 8:00 a 18:00
                    </T>
                </span>
                <span style={{ marginLeft: 'auto', position: 'relative', width: 82, height: 18 }}>
                    {[
                        ['ms-status1', 'A tiempo', 'mint'],
                        ['ms-status2', 'En riesgo', 'amber'],
                        ['ms-status3', 'Vencido', 'rose'],
                    ].map(([a, l, t]) => (
                        <span key={a} data-a="" style={{ animationName: a, position: 'absolute', right: 0, top: 0, display: 'inline-flex', alignItems: 'center', height: 18, padding: '0 8px', borderRadius: 5, background: tone(t as 'mint'), color: '#fff', fontSize: 8.5, fontWeight: 700, opacity: a === 'ms-status3' ? 1 : 0 }}>
                            {l}
                        </span>
                    ))}
                </span>
            </At>

            {/* La barra del tiempo hábil */}
            <At x={BAR_X} y={92} w={BAR_W} h={14} style={{ borderRadius: 99, background: C.muted, overflow: 'hidden' }}>
                <span data-a="" style={{ animationName: 'ms-fill, ms-col', display: 'block', height: '100%', width: BAR_W, background: 'hsl(var(--imcrm-destructive))' }} />
            </At>
            {/* Marca del 75% */}
            <At x={BAR_X + BAR_W * 0.75} y={86} w={2} h={26} style={{ background: tone('amber'), borderRadius: 1 }} />
            <At x={BAR_X + BAR_W * 0.75 - 18} y={72}>
                <T size={8} weight={700} color={tone('amber')}>
                    75 %
                </T>
            </At>

            {[0, 2, 4, 6, 8].map((h) => (
                <At key={h} x={BAR_X + (BAR_W * h) / 8 - 24} y={112} w={48} style={{ textAlign: 'center' }}>
                    <T size={8} color={C.mutedFg}>
                        {h === 8 ? '8 h hábiles' : `${h} h`}
                    </T>
                </At>
            ))}

            {/* Pausas: la noche y la espera del cliente */}
            <At x={BAR_X + BAR_W * 0.25 - 64} y={136} w={128} a="ms-night" style={{ opacity: 0, background: C.card, border: `1px dashed ${C.border}`, borderRadius: 9, padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Moon size={11} color={C.mutedFg} />
                <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block' }}>
                    Lunes 18:00 a martes 8:00: no cuenta
                </T>
            </At>
            <At x={BAR_X + BAR_W * 0.5 - 64} y={136} w={128} a="ms-pause" style={{ opacity: 0, background: C.card, border: `1px dashed ${C.border}`, borderRadius: 9, padding: '6px 8px', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Pause size={11} color={C.mutedFg} />
                <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', display: 'block' }}>
                    Esperando al cliente: el reloj se detiene
                </T>
            </At>

            {/* Aviso en riesgo */}
            <At x={24} y={190} w={208} a="ms-risk" style={{ background: C.card, border: `1px solid ${tone('amber', 0.5)}`, borderRadius: 10, padding: '8px 10px', display: 'flex', gap: 7, boxShadow: '0 10px 24px -14px rgba(15,23,42,.5)' }}>
                <span style={{ width: 22, height: 22, borderRadius: 6, background: tone('amber', 0.16), color: tone('amber'), display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <BellRing size={12} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <T size={9} weight={700}>
                        En riesgo: vence a las 12:00
                    </T>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Avatar initials="JH" t="blue" size={14} />
                        <T size={8} color={C.mutedFg}>
                            Aviso al responsable
                        </T>
                    </span>
                </span>
            </At>

            {/* Vencido: escalamiento */}
            <At x={248} y={190} w={208} a="ms-late" style={{ background: C.card, border: '1px solid hsl(var(--imcrm-destructive) / .5)', borderRadius: 10, padding: '8px 10px', display: 'flex', gap: 7, boxShadow: '0 10px 24px -14px rgba(15,23,42,.5)' }}>
                <span style={{ width: 22, height: 22, borderRadius: 6, background: 'hsl(var(--imcrm-destructive) / .14)', color: C.destructive, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <TriangleAlert size={12} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <T size={9} weight={700}>
                        Vencido: se escala
                    </T>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Avatar initials="LG" t="violet" size={14} />
                        <T size={8} color={C.mutedFg}>
                            Aviso a la gerencia · prioridad Urgente
                        </T>
                    </span>
                </span>
            </At>
        </Stage>
    );
}
