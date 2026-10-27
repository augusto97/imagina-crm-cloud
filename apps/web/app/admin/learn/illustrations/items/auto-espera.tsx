import { CalendarDays, Filter, Hourglass, Mail, PenLine } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * El paso «Esperar»: sale el recordatorio, la automatización se queda en
 * espera tres días (sin ocupar a nadie), vuelve a leer la factura y, como
 * sigue pendiente, la marca vencida. Si se hubiera pagado, terminaba ahí.
 */

const CSS = `
@keyframes aes-fill{0%,10%{transform:scaleX(0)}16%{transform:scaleX(.08)}58%{transform:scaleX(.58)}66%{transform:scaleX(.72)}80%,94%{transform:scaleX(1)}100%{transform:scaleX(0)}}
@keyframes aes-s0{0%,4%{box-shadow:0 0 0 0 transparent}8%,16%{box-shadow:0 0 0 3px ${primary(0.3)}}22%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes aes-s1{0%,16%{box-shadow:0 0 0 0 transparent}20%,56%{box-shadow:0 0 0 3px ${primary(0.3)}}60%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes aes-s2{0%,58%{box-shadow:0 0 0 0 transparent}62%,70%{box-shadow:0 0 0 3px ${primary(0.3)}}76%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes aes-s3{0%,72%{box-shadow:0 0 0 0 transparent}76%,86%{box-shadow:0 0 0 3px ${primary(0.3)}}92%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes aes-d0{0%,26%{opacity:1}29%,100%{opacity:0}}
@keyframes aes-d1{0%,26%{opacity:0}29%,38%{opacity:1}41%,100%{opacity:0}}
@keyframes aes-d2{0%,38%{opacity:0}41%,50%{opacity:1}53%,100%{opacity:0}}
@keyframes aes-d3{0%,50%{opacity:0}53%,96%{opacity:1}100%{opacity:0}}
@keyframes aes-wait{0%,18%{opacity:0;transform:translateY(6px)}22%,56%{opacity:1;transform:translateY(0)}60%,100%{opacity:0;transform:translateY(6px)}}
@keyframes aes-sand{0%,18%{transform:rotate(0)}30%{transform:rotate(180deg)}42%{transform:rotate(180deg)}54%,100%{transform:rotate(360deg)}}
@keyframes aes-yes{0%,62%{opacity:0;transform:scale(.6)}66%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes aes-old{0%,76%{opacity:1}80%,96%{opacity:0}100%{opacity:1}}
@keyframes aes-new{0%,76%{opacity:0;transform:scale(.7)}81%,93%{opacity:1;transform:scale(1)}98%,100%{opacity:0}}
`;

const STATIONS = [
    { x: 30, icon: <Mail size={13} />, t: 'blue' as const, k: 'Paso 1', title: 'Correo al cliente', sub: 'Recordatorio de pago', a: 'aes-s0' },
    { x: 140, icon: <Hourglass size={13} />, t: 'slate' as const, k: 'Paso 2', title: 'Esperar 3 días', sub: 'Continuar sólo si sigue pendiente', a: 'aes-s1' },
    { x: 250, icon: <Filter size={13} />, t: 'violet' as const, k: 'Al volver', title: '¿Sigue pendiente?', sub: 'Vuelve a leer la factura', a: 'aes-s2' },
    { x: 360, icon: <PenLine size={13} />, t: 'rose' as const, k: 'Paso 3', title: 'Marcar vencida', sub: 'y avisar a cartera', a: 'aes-s3' },
];

export default function AutoEspera(): JSX.Element {
    return (
        <Stage label="El paso Esperar: sale el recordatorio, la automatización espera tres días, vuelve a leer la factura y como sigue pendiente la marca vencida; si se hubiera pagado, terminaba ahí." tint="slate">
            <Keyframes css={CSS} />
            {/* Calendario que avanza */}
            <At x={176} y={20} w={128} h={28} style={{ borderRadius: 9, background: C.card, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, boxShadow: '0 6px 16px -12px rgba(15,23,42,.45)' }}>
                <CalendarDays size={12} color={primary()} />
                <span style={{ position: 'relative', width: 74, height: 14 }}>
                    {['Lun 26/10', 'Mar 27/10', 'Mié 28/10', 'Jue 29/10'].map((d, i) => (
                        <span key={d} data-a="" style={{ position: 'absolute', left: 0, top: 0, display: 'flex', opacity: i === 3 ? 1 : 0, animationName: `aes-d${i}` }}>
                            <T size={9.6} weight={700}>
                                {d}
                            </T>
                        </span>
                    ))}
                </span>
            </At>

            {/* La línea de tiempo */}
            <At x={75} y={89} w={330} h={4} style={{ borderRadius: 99, background: C.border }} />
            <At x={75} y={89} w={330} h={4} a="aes-fill" style={{ borderRadius: 99, background: primary(), transformOrigin: '0 50%' }} />
            {STATIONS.map((s) => (
                <At key={s.title} x={s.x} y={74} w={90} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <span data-a="" style={{ width: 34, height: 34, borderRadius: 99, background: tone(s.t), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `3px solid ${C.card}`, animationName: s.a }}>
                        {s.icon}
                    </span>
                </At>
            ))}
            {STATIONS.map((s, i) => (
                <At key={`c${i}`} x={s.x - 4} y={130} w={98} h={62} style={{ borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, padding: '7px 8px', display: 'flex', flexDirection: 'column', gap: 3, boxShadow: '0 8px 20px -14px rgba(15,23,42,.45)' }}>
                    <T size={6.8} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                        {s.k}
                    </T>
                    <T size={8.6} weight={700}>
                        {s.title}
                    </T>
                    <T size={7.2} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.3 }}>
                        {s.sub}
                    </T>
                </At>
            ))}
            <At x={318} y={68} a="aes-yes" style={{ zIndex: 3 }}>
                <span style={{ height: 16, padding: '0 6px', borderRadius: 99, background: C.success, color: '#fff', fontSize: 7.6, fontWeight: 800, display: 'inline-flex', alignItems: 'center' }}>✓ Sí</span>
            </At>

            {/* La corrida en espera */}
            <At x={86} y={246} w={308} a="aes-wait" style={{ opacity: 0, borderRadius: 9, background: tone('amber', 0.12), border: `1px solid ${tone('amber', 0.35)}`, padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 7 }}>
                <span data-a="" style={{ display: 'flex', color: tone('amber'), animationName: 'aes-sand' }}>
                    <Hourglass size={13} />
                </span>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1, flex: 1 }}>
                    <T size={8.4} weight={700}>
                        En espera hasta el jueves 29/10 a las 09:00
                    </T>
                    <T size={7.4} color={C.mutedFg}>
                        Historial de la automatización
                    </T>
                </span>
                <span style={{ height: 18, padding: '0 7px', borderRadius: 5, border: `1px solid ${C.border}`, background: C.card, fontSize: 7.6, fontWeight: 600, display: 'inline-flex', alignItems: 'center', whiteSpace: 'nowrap' }}>Cancelar espera</span>
            </At>

            {/* La factura */}
            <At x={150} y={206} w={180} h={30} style={{ borderRadius: 9, background: C.card, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px' }}>
                <T size={8.8} weight={700}>
                    FAC-1042
                </T>
                <T size={7.6} color={C.mutedFg} style={{ flex: 1 }}>
                    Estado
                </T>
                <span style={{ position: 'relative', display: 'block', width: 58, height: 16 }}>
                    <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', opacity: 0, animationName: 'aes-old' }}>
                        <span style={{ height: 16, padding: '0 7px', borderRadius: 5, background: tone('amber'), color: '#fff', fontSize: 9, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>Pendiente</span>
                    </span>
                    <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', animationName: 'aes-new' }}>
                        <span style={{ height: 16, padding: '0 7px', borderRadius: 5, background: tone('rose'), color: '#fff', fontSize: 9, fontWeight: 600, display: 'inline-flex', alignItems: 'center' }}>Vencida</span>
                    </span>
                </span>
            </At>
        </Stage>
    );
}
