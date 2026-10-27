import { Bell, Download, Smartphone, Sparkles } from 'lucide-react';

import { At, Avatar, Btn, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * La app instalada en el teléfono avisa aunque esté cerrada: llega una
 * notificación a la pantalla bloqueada y al tocarla se abre el registro.
 */

const CSS = `
@keyframes ps-install{0%,4%{opacity:0;transform:translateY(8px)}8%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes ps-icon{0%,24%{opacity:0;transform:scale(.4)}30%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes ps-n1{0%,40%{opacity:0;transform:translateY(-30px)}46%,66%{opacity:1;transform:translateY(0)}70%,100%{opacity:0;transform:translateY(-10px) scale(.95)}}
@keyframes ps-tap{0%,60%{opacity:0;transform:scale(.4)}63%{opacity:1;transform:scale(1)}68%,100%{opacity:0;transform:scale(1.7)}}
@keyframes ps-app{0%,68%{opacity:0;transform:scale(.94)}73%,92%{opacity:1;transform:scale(1)}97%,100%{opacity:0}}
@keyframes ps-lock{0%,68%{opacity:1}72%,96%{opacity:0}100%{opacity:1}}
@keyframes ps-desk{0%,40%{opacity:0;transform:translateX(20px)}46%,92%{opacity:1;transform:translateX(0)}97%,100%{opacity:0}}
`;

export default function DiaPush(): JSX.Element {
    return (
        <Stage label="Se instala la app y su ícono aparece en el teléfono; con la app cerrada llega una notificación a la pantalla bloqueada y al tocarla se abre el registro. En el computador llega el mismo aviso." tint="cyan">
            <Keyframes css={CSS} />
            {/* Teléfono */}
            <At x={40} y={14} w={150} h={272} style={{ borderRadius: 24, background: C.card, border: `5px solid ${C.fg}`, boxShadow: '0 22px 44px -20px rgba(15,23,42,.6)', overflow: 'hidden' }}>
                {/* pantalla bloqueada */}
                <At x={0} y={0} w={140} h={262} a="ps-lock" style={{ background: `linear-gradient(160deg, ${primary(0.35)}, ${tone('violet', 0.3)})` }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 26, gap: 1 }}>
                        <T size={30} weight={300}>
                            9:41
                        </T>
                        <T size={8} color={C.mutedFg}>
                            martes, 27 de octubre
                        </T>
                    </div>
                    {/* ícono instalado */}
                    <At x={16} y={200} a="ps-icon" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        <span style={{ width: 30, height: 30, borderRadius: 8, background: primary(), color: C.primaryFg, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 6px 14px -6px rgba(15,23,42,.6)' }}>
                            <Sparkles size={15} />
                        </span>
                        <T size={6.5} weight={600}>
                            Café Aurora
                        </T>
                    </At>
                    {/* notificación */}
                    <At x={8} y={92} w={124} a="ps-n1" style={{ opacity: 0, background: C.card, borderRadius: 12, padding: '7px 8px', boxShadow: '0 10px 24px -12px rgba(15,23,42,.6)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ width: 12, height: 12, borderRadius: 3, background: primary(), color: C.primaryFg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Sparkles size={7} />
                            </span>
                            <T size={6.5} weight={700} color={C.mutedFg}>
                                CAFÉ AURORA · ahora
                            </T>
                        </span>
                        <T size={8} weight={700}>
                            Te asignaron un registro
                        </T>
                        <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.3 }}>
                            Carlos te asignó «Visita a Hotel Brisas»
                        </T>
                    </At>
                    <At x={60} y={114} a="ps-tap" style={{ opacity: 0 }}>
                        <span style={{ display: 'block', width: 22, height: 22, borderRadius: 99, background: primary(0.35), border: `2px solid ${primary()}` }} />
                    </At>
                </At>
                {/* la app abierta en el registro */}
                <At x={0} y={0} w={140} h={262} a="ps-app" style={{ opacity: 0, background: C.card }}>
                    <div style={{ height: 30, display: 'flex', alignItems: 'center', gap: 5, padding: '0 9px', borderBottom: `1px solid ${C.border}` }}>
                        <T size={7.5} color={C.mutedFg}>
                            Citas
                        </T>
                    </div>
                    <div style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 7 }}>
                        <T size={11} weight={700} style={{ whiteSpace: 'normal' }}>
                            Visita a Hotel Brisas
                        </T>
                        {[
                            ['Fecha', '28/10 10:00'],
                            ['Lugar', 'Cartagena'],
                            ['Responsable', 'Laura G.'],
                        ].map(([k, v]) => (
                            <span key={k} style={{ display: 'flex', flexDirection: 'column', gap: 1, borderBottom: `1px solid ${C.border}`, paddingBottom: 4 }}>
                                <T size={7} color={C.mutedFg}>
                                    {k}
                                </T>
                                <T size={8.5} weight={600}>
                                    {v}
                                </T>
                            </span>
                        ))}
                    </div>
                </At>
            </At>

            {/* Instalar */}
            <At x={220} y={26} w={240} a="ps-install" style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 16px 36px -18px rgba(15,23,42,.5)', padding: 12, display: 'flex', flexDirection: 'column', gap: 7 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span style={{ width: 24, height: 24, borderRadius: 7, background: primary(0.14), color: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Smartphone size={13} />
                    </span>
                    <T size={10} weight={700}>
                        App en este dispositivo
                    </T>
                </span>
                <T size={8} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.35 }}>
                    Queda con tus aplicaciones, se abre en su propia ventana y te avisa aunque esté cerrada.
                </T>
                <Btn label={<><Download size={10} /> Instalar la app</>} style={{ alignSelf: 'flex-start' }} />
            </At>

            {/* Computador */}
            <At x={220} y={146} w={244} h={140} a="ps-desk" style={{ opacity: 0 }}>
                <div style={{ height: 120, borderRadius: 10, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 16px 36px -20px rgba(15,23,42,.5)', position: 'relative', overflow: 'hidden' }}>
                    {Array.from({ length: 4 }).map((_, i) => (
                        <div key={i} style={{ margin: '12px 12px 0', height: 6, width: 120 - i * 18, borderRadius: 99, background: C.muted }} />
                    ))}
                    <At x={86} y={44} w={150} style={{ background: C.card, borderRadius: 9, border: `1px solid ${C.border}`, boxShadow: '0 12px 26px -12px rgba(15,23,42,.6)', padding: '7px 8px', display: 'flex', gap: 6 }}>
                        <Avatar initials="CR" t="blue" size={18} />
                        <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            <T size={7.5} weight={700}>
                                Te asignaron un registro
                            </T>
                            <T size={7} color={C.mutedFg}>
                                «Visita a Hotel Brisas»
                            </T>
                        </span>
                        <Bell size={9} color={primary()} />
                    </At>
                </div>
                <div style={{ width: 70, height: 8, margin: '0 auto', background: C.border, borderRadius: '0 0 6px 6px' }} />
            </At>
        </Stage>
    );
}
