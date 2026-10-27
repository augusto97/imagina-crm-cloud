import { AlarmClock, AtSign, Bell, ClipboardCheck, MessageSquare, UserPlus } from 'lucide-react';

import { At, Avatar, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * La campana: llega un aviso nuevo (la campana se mueve y el contador sube),
 * se abre la bandeja y al tocar el aviso se abre el registro, que queda leído.
 */

const CSS = `
@keyframes cb-shake{0%,10%{transform:rotate(0)}12%{transform:rotate(14deg)}14%{transform:rotate(-12deg)}16%{transform:rotate(8deg)}18%{transform:rotate(-5deg)}20%,100%{transform:rotate(0)}}
@keyframes cb-b2{0%,11%{opacity:1}12%,100%{opacity:0}}
@keyframes cb-b3{0%,11%{opacity:0;transform:scale(.5)}13%,60%{opacity:1;transform:scale(1)}62%,100%{opacity:0}}
@keyframes cb-b2b{0%,60%{opacity:0}62%,94%{opacity:1}98%,100%{opacity:0}}
@keyframes cb-toast{0%,10%{opacity:0;transform:translateY(-10px)}14%,26%{opacity:1;transform:translateY(0)}30%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes cb-pop{0%,30%{opacity:0;transform:translateY(-6px) scale(.98)}34%,58%{opacity:1;transform:translateY(0) scale(1)}62%,100%{opacity:0;transform:translateY(-6px)}}
@keyframes cb-new{0%,34%{background:${primary(0.14)}}52%{background:${primary(0.14)}}56%,100%{background:transparent}}
@keyframes cb-dot{0%,56%{opacity:1}58%,100%{opacity:0}}
@keyframes cb-rec{0%,60%{opacity:0;transform:translateY(10px)}66%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes cb-hl{0%,66%{box-shadow:0 0 0 0 transparent}70%,86%{box-shadow:0 0 0 3px ${primary(0.4)}}92%,100%{box-shadow:0 0 0 0 transparent}}
@keyframes cb-cur{0%{transform:translate(300px,250px);opacity:0}24%{opacity:0;transform:translate(300px,250px)}27%{opacity:1}31%,32%{transform:translate(402px,28px)}48%,54%{transform:translate(214px,112px)}70%,88%{transform:translate(380px,250px);opacity:1}93%,100%{transform:translate(380px,250px);opacity:0}}
@keyframes cb-ring{0%,30%{opacity:0;transform:scale(.4)}32%{opacity:1;transform:scale(1)}36%{opacity:0;transform:scale(1.6)}52%{opacity:0;transform:scale(.4)}54%{opacity:1;transform:scale(1)}58%,100%{opacity:0;transform:scale(1.6)}}
`;

function Notif({ icon, t, who, title, sub, when, a, dot }: { icon: JSX.Element; t: 'violet' | 'blue' | 'amber' | 'mint' | 'rose'; who: string; title: string; sub: string; when: string; a?: string; dot?: boolean }): JSX.Element {
    return (
        <div data-a={a ? '' : undefined} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 10px', borderBottom: `1px solid ${C.border}`, animationName: a }}>
            <span style={{ position: 'relative' }}>
                <Avatar initials={who} t={t} size={22} />
                <span style={{ position: 'absolute', right: -3, bottom: -3, width: 12, height: 12, borderRadius: 99, background: C.card, color: tone(t), display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 0 1px ${C.border}` }}>{icon}</span>
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
                <T size={8.5} weight={600} style={{ whiteSpace: 'normal', lineHeight: 1.3 }}>
                    {title}
                </T>
                <T size={7.5} color={C.mutedFg}>
                    {sub} · {when}
                </T>
            </span>
            {dot !== undefined && <span data-a="" style={{ width: 7, height: 7, borderRadius: 99, background: primary(), marginTop: 4, animationName: dot ? 'cb-dot' : undefined, opacity: dot ? 0 : 1 }} />}
        </div>
    );
}

export default function DiaCampana(): JSX.Element {
    return (
        <Stage label="Llega un aviso: la campana se mueve y el contador pasa de 2 a 3; se abre la bandeja con menciones, asignaciones y recordatorios, y al tocar el aviso se abre el registro con el comentario resaltado." tint="rose">
            <Keyframes css={CSS} />
            {/* Barra superior */}
            <At x={16} y={12} w={448} h={34} style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 12px', gap: 10 }}>
                <span style={{ flex: 1, height: 18, borderRadius: 6, background: C.muted, maxWidth: 190 }} />
            </At>
            <At x={390} y={18} w={22} h={22} a="cb-shake" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.fg, transformOrigin: '50% 10%' }}>
                <Bell size={14} />
            </At>
            {[
                ['2', 'cb-b2', 1],
                ['3', 'cb-b3', 0],
                ['2', 'cb-b2b', 1],
            ].map(([n, a, base]) => (
                <At key={a as string} x={403} y={14} a={a as string} style={{ opacity: base as number }}>
                    <span style={{ minWidth: 13, height: 13, borderRadius: 99, background: C.destructive, color: '#fff', fontSize: 7.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{n as string}</span>
                </At>
            ))}
            <At x={420} y={19}>
                <Avatar initials="LG" t="cyan" size={20} />
            </At>

            {/* La app detrás */}
            <At x={16} y={54} w={448} h={232} style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: '10px 16px' }}>
                {Array.from({ length: 7 }).map((_, i) => (
                    <div key={i} style={{ display: 'flex', gap: 14, alignItems: 'center', height: 30, borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: 96, height: 6, borderRadius: 99, background: C.muted }} />
                        <span style={{ width: 60, height: 6, borderRadius: 99, background: C.muted }} />
                        <span style={{ width: 42, height: 12, borderRadius: 4, background: tone(i % 3 === 0 ? 'violet' : i % 3 === 1 ? 'blue' : 'mint', 0.3) }} />
                    </div>
                ))}
            </At>
            {/* Aviso al vuelo */}
            <At x={208} y={54} w={196} a="cb-toast" style={{ opacity: 0, zIndex: 6 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 9, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 12px 28px -12px rgba(15,23,42,.55)' }}>
                    <AtSign size={11} color={tone('violet')} />
                    <T size={8.5} weight={600}>
                        Ana te mencionó en «Hotel Brisas»
                    </T>
                </span>
            </At>

            {/* Bandeja */}
            <At x={196} y={50} w={232} h={226} a="cb-pop" style={{ opacity: 0, zIndex: 5, background: C.card, borderRadius: 11, border: `1px solid ${C.border}`, boxShadow: '0 20px 44px -18px rgba(15,23,42,.6)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 10px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={10} weight={700}>
                        Avisos
                    </T>
                    <span style={{ display: 'flex', gap: 4 }}>
                        <span style={{ fontSize: 7.5, fontWeight: 700, padding: '2px 6px', borderRadius: 99, background: C.muted, color: C.mutedFg }}>Todos</span>
                        <span style={{ fontSize: 7.5, fontWeight: 700, padding: '2px 6px', borderRadius: 99, background: primary(0.14), color: primary() }}>Sin leer (3)</span>
                    </span>
                </div>
                <Notif a="cb-new" dot icon={<AtSign size={7} />} t="violet" who="AM" title="Ana te mencionó en «Hotel Brisas»" sub="Oportunidades" when="ahora" />
                <Notif dot={false} icon={<UserPlus size={7} />} t="blue" who="CR" title="Carlos te asignó «Revisar contrato»" sub="Tareas" when="hace 10 min" />
                <Notif dot={false} icon={<ClipboardCheck size={7} />} t="amber" who="JH" title="Jorge pide tu aprobación: «Compra de equipos»" sub="Compras" when="hace 1 h" />
                <Notif icon={<AlarmClock size={7} />} t="mint" who="LG" title="Recordatorio: llamar al proveedor" sub="Mi trabajo" when="ayer" />
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 10px' }}>
                    <T size={7.5} weight={600} color={primary()}>
                        Ir a Mi trabajo
                    </T>
                    <T size={7.5} weight={600} color={C.mutedFg}>
                        Preferencias
                    </T>
                </div>
            </At>

            {/* El registro que se abre */}
            <At x={52} y={70} w={376} h={168} a="cb-rec" style={{ opacity: 0, zIndex: 4, background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 20px 44px -18px rgba(15,23,42,.55)', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, height: 26, padding: '0 12px', borderBottom: `1px solid ${C.border}` }}>
                    <T size={8} color={C.mutedFg}>
                        Oportunidades / Hotel Brisas
                    </T>
                </div>
                <div style={{ display: 'flex' }}>
                    <div style={{ flex: 1, padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <T size={13} weight={700}>
                            Hotel Brisas
                        </T>
                        {[
                            ['Etapa', 'Propuesta'],
                            ['Valor', '$ 3.600.000'],
                            ['Responsable', 'Laura Gómez'],
                        ].map(([k, v]) => (
                            <span key={k} style={{ display: 'flex', gap: 8 }}>
                                <T size={8} color={C.mutedFg} style={{ width: 62 }}>
                                    {k}
                                </T>
                                <T size={8.5} weight={600}>
                                    {v}
                                </T>
                            </span>
                        ))}
                    </div>
                    <div style={{ width: 168, borderLeft: `1px solid ${C.border}`, padding: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <MessageSquare size={9} color={C.mutedFg} />
                            <T size={8} weight={700} color={C.mutedFg}>
                                Comentarios
                            </T>
                        </span>
                        <div data-a="" style={{ borderRadius: 8, padding: 7, background: C.muted, display: 'flex', flexDirection: 'column', gap: 3, animationName: 'cb-hl' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <Avatar initials="AM" t="violet" size={14} />
                                <T size={8} weight={700}>
                                    Ana Martínez
                                </T>
                            </span>
                            <T size={8} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                                <b style={{ color: primary() }}>@Laura</b> el cliente aprobó la propuesta, ¿enviamos el contrato hoy?
                            </T>
                        </div>
                    </div>
                </div>
            </At>
            <Cursor a="cb-cur" click="cb-ring" rest={[380, 250]} />
        </Stage>
    );
}
