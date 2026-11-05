import { CalendarClock, Link2, MessageCircle, Users, Video } from 'lucide-react';

import { At, Bubble, C, Flow, IconSquare, Keyframes, Pill, Stage, T, Win, primary, tone } from '../kit';

/**
 * Agendar una demo desde un registro (v0.1.366): el vendedor pone la fecha,
 * la automatización crea la reunión de Teams con los invitados, el enlace y
 * el id del evento quedan en el registro y el enlace sale por WhatsApp.
 */

const CSS = `
@keyframes rt-date{0%,4%{background:transparent;color:${C.mutedFg}}10%,24%{background:${primary(0.18)};color:${C.fg}}32%,100%{background:transparent;color:${C.fg}}}
@keyframes rt-step{0%,18%{opacity:.35;transform:scale(.96)}26%,92%{opacity:1;transform:scale(1)}100%{opacity:.35}}
@keyframes rt-glow{0%,22%{box-shadow:0 0 0 0 ${primary(0)}}30%{box-shadow:0 0 0 6px ${primary(0.22)}}40%,100%{box-shadow:0 0 0 0 ${primary(0)}}}
@keyframes rt-inv{0%,32%{opacity:0;transform:translateY(6px)}40%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes rt-flow1{0%,22%{opacity:0}28%,92%{opacity:1}100%{opacity:0}}
@keyframes rt-link{0%,46%{opacity:0;transform:translateX(-8px)}54%,92%{opacity:1;transform:translateX(0)}100%{opacity:0}}
@keyframes rt-id{0%,52%{opacity:0;transform:translateX(-8px)}60%,92%{opacity:1;transform:translateX(0)}100%{opacity:0}}
@keyframes rt-flow2{0%,58%{opacity:0}64%,92%{opacity:1}100%{opacity:0}}
@keyframes rt-wa{0%,64%{opacity:0;transform:translateY(10px)}72%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
`;

function Row({ label, children }: { label: string; children: JSX.Element }): JSX.Element {
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                height: 26,
                borderBottom: `1px solid ${C.border}`,
            }}
        >
            <T size={8.5} color={C.mutedFg} style={{ width: 82, flexShrink: 0 }}>
                {label}
            </T>
            {children}
        </div>
    );
}

export default function ReunionTeams(): JSX.Element {
    return (
        <Stage
            label="El vendedor pone la fecha de la demo en una oportunidad: la automatización crea la reunión de Teams e invita al cliente y a gerencia, guarda el enlace y el id del evento en el registro y le manda el enlace al cliente por WhatsApp."
            cycle={8}
            tint="blue"
        >
            <Keyframes css={CSS} />
            <At x={16} y={16} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <IconSquare t="blue" size={24}>
                    <CalendarClock size={13} />
                </IconSquare>
                <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <T size={11} weight={700}>
                        Demo comercial
                    </T>
                    <T size={8.5} color={C.mutedFg}>
                        Se agenda sola al poner la fecha
                    </T>
                </span>
            </At>

            <Win x={16} y={58} w={226} h={170} title="Oportunidades · Hotel Brisas">
                <At x={10} y={8} w={206}>
                    <Row label="Etapa">
                        <Pill t="blue" label="Demo" />
                    </Row>
                    <Row label="Fecha de la demo">
                        <span
                            data-a=""
                            style={{
                                animationName: 'rt-date',
                                fontSize: 9.5,
                                fontWeight: 600,
                                padding: '1px 5px',
                                borderRadius: 4,
                            }}
                        >
                            12 nov · 10:00
                        </span>
                    </Row>
                    <Row label="Enlace de la reunión">
                        <span
                            data-a=""
                            style={{
                                animationName: 'rt-link',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3,
                                fontSize: 9,
                                fontWeight: 600,
                                color: primary(),
                            }}
                        >
                            <Link2 size={9} /> teams.microsoft.com/l/…
                        </span>
                    </Row>
                    <Row label="Id del evento">
                        <span
                            data-a=""
                            style={{
                                animationName: 'rt-id',
                                fontSize: 8.5,
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                color: C.fg,
                            }}
                        >
                            AAMkAGQ5…
                        </span>
                    </Row>
                    <Row label="Cliente">
                        <T size={9.5}>Laura Ríos</T>
                    </Row>
                </At>
            </Win>

            <At x={242} y={110} a="rt-flow1">
                <Flow x1={0} y1={0} x2={24} y2={-36} />
            </At>
            <At
                x={266}
                y={52}
                w={198}
                a="rt-step"
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    padding: '9px 10px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    boxShadow: '0 8px 20px -14px rgba(15,23,42,.45)',
                }}
            >
                <span data-a="" style={{ animationName: 'rt-glow', display: 'flex', alignItems: 'center', gap: 7, borderRadius: 7 }}>
                    <IconSquare t="violet" size={22}>
                        <Video size={12} />
                    </IconSquare>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <T size={9.5} weight={700}>
                            Crear reunión de Teams
                        </T>
                        <T size={8} color={C.mutedFg}>
                            jue 12 nov · 10:00 a 10:45
                        </T>
                    </span>
                </span>
                <span data-a="" style={{ animationName: 'rt-inv', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                    <Users size={9} color={C.mutedFg} />
                    <Pill t="cyan" label="laura@hotelbrisas.co" style={{ height: 16, fontSize: 8 }} />
                    <Pill t="amber" label="gerencia@" style={{ height: 16, fontSize: 8 }} />
                </span>
            </At>

            <At x={242} y={190} a="rt-flow2">
                <Flow x1={0} y1={0} x2={24} y2={20} />
            </At>
            <At x={266} y={166} w={198} a="rt-wa" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <MessageCircle size={10} color={tone('mint')} />
                    <T size={8.5} weight={700} color={C.mutedFg}>
                        WhatsApp a Laura
                    </T>
                </span>
                <Bubble side="right" style={{ maxWidth: 198 }}>
                    Hola Laura, tu demo es el jueves 12 a las 10:00. Únete aquí:{' '}
                    <span style={{ color: primary(), fontWeight: 600 }}>teams.microsoft.com/l/…</span>
                </Bubble>
            </At>
        </Stage>
    );
}
