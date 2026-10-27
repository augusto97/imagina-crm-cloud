import { CalendarClock, Filter, Mail, MessageCircle, PenLine, Zap } from 'lucide-react';

import { At, C, Chip, Flow, IconSquare, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * Portada de Automatizaciones: una factura vence → la automatización revisa si
 * sigue pendiente → manda el recordatorio por correo y WhatsApp y cambia su
 * estado a «Vencida». Disparador → condición → acciones, de un vistazo.
 */

const CSS = `
@keyframes af-row{0%,4%{background:transparent}8%,30%{background:${primary(0.1)}}40%,100%{background:transparent}}
@keyframes af-due{0%,3%{opacity:0;transform:scale(.5)}7%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes af-s1{0%,12%{box-shadow:0 0 0 0 transparent}16%,26%{box-shadow:0 0 0 3px ${primary(0.35)}}32%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes af-s2{0%,30%{box-shadow:0 0 0 0 transparent}34%,42%{box-shadow:0 0 0 3px ${primary(0.35)}}48%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes af-s3{0%,46%{box-shadow:0 0 0 0 transparent}50%,58%{box-shadow:0 0 0 3px ${primary(0.35)}}64%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes af-ok{0%,36%{opacity:0;transform:scale(.4)}40%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes af-dot{0%,10%{opacity:0;transform:translate(0,0)}12%{opacity:1;transform:translate(0,0)}21%{opacity:1;transform:translate(22px,-82px)}23%,30%{opacity:0;transform:translate(22px,-82px)}31%{opacity:1;transform:translate(85px,-58px)}34%{opacity:1;transform:translate(85px,-40px)}35%,42%{opacity:0;transform:translate(85px,-40px)}43%{opacity:1;transform:translate(85px,6px)}47%{opacity:1;transform:translate(85px,24px)}48%,100%{opacity:0;transform:translate(85px,24px)}}
@keyframes af-lines{0%,55%{opacity:0}59%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes af-o1{0%,58%{opacity:0;transform:translateX(-12px)}63%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes af-o2{0%,63%{opacity:0;transform:translateX(-12px)}68%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes af-o3{0%,68%{opacity:0;transform:translateX(-12px)}73%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
@keyframes af-old{0%,72%{opacity:1}76%,96%{opacity:0}100%{opacity:1}}
@keyframes af-new{0%,72%{opacity:0;transform:scale(.7)}77%,94%{opacity:1;transform:scale(1)}98%,100%{opacity:0}}
`;

const ROWS = [
    { n: 'FAC-1041', who: 'Clínica Norte', amt: '$ 820.000', st: 'Pagada', t: 'mint' as const },
    { n: 'FAC-1042', who: 'Hotel Brisas', amt: '$ 1.250.000', st: 'Pendiente', t: 'amber' as const },
    { n: 'FAC-1043', who: 'Colegio Andino', amt: '$ 460.000', st: 'Pendiente', t: 'amber' as const },
];

function Step({ y, kicker, title, icon, t, a }: { y: number; kicker: string; title: string; icon: JSX.Element; t: 'amber' | 'violet' | 'blue'; a: string }): JSX.Element {
    return (
        <At
            x={200}
            y={y}
            w={130}
            h={46}
            a={a}
            style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '0 8px',
                boxShadow: '0 8px 20px -14px rgba(15,23,42,.45)',
            }}
        >
            <IconSquare t={t} size={22}>
                {icon}
            </IconSquare>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <T size={7.5} weight={700} color={C.mutedFg} style={{ textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {kicker}
                </T>
                <T size={9} weight={600}>
                    {title}
                </T>
            </span>
        </At>
    );
}

function Out({ y, a, icon, t, title, sub }: { y: number; a: string; icon: JSX.Element; t: 'blue' | 'mint' | 'rose'; title: string; sub: string }): JSX.Element {
    return (
        <At
            x={350}
            y={y}
            w={118}
            h={44}
            a={a}
            style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '0 8px',
                boxShadow: '0 8px 20px -14px rgba(15,23,42,.45)',
            }}
        >
            <span style={{ width: 22, height: 22, borderRadius: 99, background: tone(t, 0.16), color: tone(t), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{icon}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
                <T size={9} weight={600}>
                    {title}
                </T>
                <T size={7.5} color={C.mutedFg}>
                    {sub}
                </T>
            </span>
        </At>
    );
}

export default function AutoFlujo(): JSX.Element {
    return (
        <Stage label="Una automatización en acción: vence una factura, la app revisa que siga pendiente, le manda el recordatorio al cliente por correo y por WhatsApp y cambia su estado a Vencida." tint="amber">
            <Keyframes css={CSS} />
            {/* La lista de facturas */}
            <Win x={14} y={60} w={172} h={150} title="Facturas">
                {ROWS.map((r, i) => (
                    <At
                        key={r.n}
                        x={0}
                        y={8 + i * 38}
                        w={172}
                        h={34}
                        a={i === 1 ? 'af-row' : undefined}
                        style={{ padding: '4px 9px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, borderBottom: i < 2 ? `1px solid ${C.border}` : undefined }}
                    >
                        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <T size={9} weight={700}>
                                {r.n}
                            </T>
                            {i === 1 ? (
                                <span style={{ position: 'relative', display: 'block', width: 56, height: 16 }}>
                                    <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', opacity: 0, animationName: 'af-old' }}>
                                        <Chip label="Pendiente" t="amber" />
                                    </span>
                                    <span data-a="" style={{ position: 'absolute', right: 0, top: 0, display: 'flex', animationName: 'af-new' }}>
                                        <Chip label="Vencida" t="rose" />
                                    </span>
                                </span>
                            ) : (
                                <Chip label={r.st} t={r.t} />
                            )}
                        </span>
                        <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <T size={8} color={C.mutedFg}>
                                {r.who}
                            </T>
                            <T size={8} weight={600} color={C.mutedFg}>
                                {r.amt}
                            </T>
                        </span>
                    </At>
                ))}
            </Win>
            <At x={112} y={64} a="af-due" style={{ zIndex: 3 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, height: 18, padding: '0 7px', borderRadius: 99, background: C.destructive, color: '#fff', fontSize: 8.5, fontWeight: 700, boxShadow: '0 4px 10px -4px rgba(0,0,0,.35)' }}>
                    <CalendarClock size={10} /> Venció ayer
                </span>
            </At>

            {/* El flujo */}
            <At x={200} y={22} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Zap size={11} color={primary()} />
                <T size={9} weight={700} color={primary()}>
                    Cobro de facturas vencidas
                </T>
            </At>
            <Flow x1={265} y1={86} x2={265} y2={104} />
            <Flow x1={265} y1={150} x2={265} y2={168} />
            <Step y={40} kicker="Cuando" title="Vence la factura" icon={<CalendarClock size={12} />} t="amber" a="af-s1" />
            <Step y={104} kicker="Si" title="Estado es Pendiente" icon={<Filter size={12} />} t="violet" a="af-s2" />
            <Step y={168} kicker="Entonces" title="3 acciones" icon={<Zap size={12} />} t="blue" a="af-s3" />
            <At x={318} y={97} a="af-ok">
                <span style={{ width: 15, height: 15, borderRadius: 99, background: C.success, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800 }}>✓</span>
            </At>
            {/* El «pulso» que recorre el flujo */}
            <At x={176} y={145} a="af-dot" style={{ opacity: 0, zIndex: 4 }}>
                <span style={{ display: 'block', width: 9, height: 9, borderRadius: 99, background: primary(), boxShadow: `0 0 0 4px ${primary(0.2)}` }} />
            </At>

            {/* Lo que hizo */}
            <svg data-a="" width={480} height={300} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', animationName: 'af-lines' }}>
                {[92, 150, 208].map((y) => (
                    <path key={y} d={`M 330 191 C 342 191, 338 ${y}, 350 ${y}`} fill="none" stroke={primary(0.5)} strokeWidth="1.6" strokeDasharray="4 4" />
                ))}
            </svg>
            <Out y={70} a="af-o1" icon={<Mail size={12} />} t="blue" title="Correo enviado" sub="a pagos@brisas.co" />
            <Out y={128} a="af-o2" icon={<MessageCircle size={12} />} t="mint" title="WhatsApp enviado" sub="+57 310 555 0142" />
            <Out y={186} a="af-o3" icon={<PenLine size={12} />} t="rose" title="Estado → Vencida" sub="se actualizó solo" />
            <At x={200} y={246} w={266} style={{ display: 'flex', justifyContent: 'center' }}>
                <T size={8.5} color={C.mutedFg}>
                    Cuando pasa algo → si se cumple → la app lo hace sola
                </T>
            </At>
        </Stage>
    );
}
