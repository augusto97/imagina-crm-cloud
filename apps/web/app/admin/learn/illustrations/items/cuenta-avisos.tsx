import { AtSign, Bell, Mail, Smartphone } from 'lucide-react';

import { At, C, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Tus avisos: todo llega a la campana; además, por cada tipo de aviso eliges
 * si llega por correo y como notificación push en tus dispositivos.
 */

const CSS = `
@keyframes cav-row{0%,8%{background:transparent}14%,40%{background:${primary(0.08)}}48%,100%{background:transparent}}
@keyframes cav-bell{0%,18%{opacity:0;transform:scale(.4)}24%,92%{opacity:1;transform:scale(1)}100%{opacity:0}}
@keyframes cav-mail{0%,30%{opacity:0;transform:translateY(8px)}38%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes cav-push{0%,42%{opacity:0;transform:translateY(-14px)}50%,92%{opacity:1;transform:translateY(0)}100%{opacity:0}}
@keyframes cav-shake{0%,18%,30%,100%{transform:rotate(0)}21%{transform:rotate(14deg)}24%{transform:rotate(-12deg)}27%{transform:rotate(6deg)}}
`;

function Toggle({ on }: { on: boolean }): JSX.Element {
    return (
        <span
            style={{
                width: 24,
                height: 14,
                borderRadius: 99,
                background: on ? primary() : C.muted,
                position: 'relative',
                display: 'inline-block',
                border: on ? 'none' : `1px solid ${C.border}`,
            }}
        >
            <span
                style={{
                    position: 'absolute',
                    top: on ? 2 : 1.5,
                    left: on ? 12 : 2,
                    width: 10,
                    height: 10,
                    borderRadius: 99,
                    background: '#fff',
                    boxShadow: '0 1px 2px rgba(0,0,0,.25)',
                }}
            />
        </span>
    );
}

const ROWS: Array<[string, boolean, boolean]> = [
    ['Te mencionan', true, true],
    ['Te asignan un registro', true, true],
    ['Tus recordatorios', true, true],
    ['Responden a tus comentarios', false, true],
    ['Comentan un registro que sigues', false, false],
    ['Cambia un registro que sigues', false, false],
];

export default function CuentaAvisos(): JSX.Element {
    return (
        <Stage
            label="En Ajustes, Avisos, eliges por cada tipo de aviso si te llega también por correo y como notificación push. Cuando alguien te menciona, el aviso aparece en la campana, llega el correo y suena la notificación del teléfono."
            tint="amber"
        >
            <Keyframes css={CSS} />
            <At
                x={16}
                y={18}
                w={262}
                h={262}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 12,
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.4)',
                }}
            >
                <T size={11.5} weight={700}>
                    Avisos
                </T>
                <T
                    size={8}
                    color={C.mutedFg}
                    style={{
                        display: 'block',
                        marginTop: 3,
                        whiteSpace: 'normal',
                        lineHeight: 1.35,
                    }}
                >
                    Todo llega a la campana. Elige qué recibir también por correo o push.
                </T>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        marginTop: 10,
                        paddingBottom: 5,
                        borderBottom: `1px solid ${C.border}`,
                    }}
                >
                    <T size={8} weight={700} color={C.mutedFg} style={{ flex: 1 }}>
                        Qué te llega
                    </T>
                    <T size={8} weight={700} color={C.mutedFg} style={{ width: 40, textAlign: 'center' }}>
                        Correo
                    </T>
                    <T size={8} weight={700} color={C.mutedFg} style={{ width: 40, textAlign: 'center' }}>
                        Push
                    </T>
                </div>
                {ROWS.map(([label, mail, push], i) => (
                    <div
                        key={label}
                        data-a={i === 0 ? '' : undefined}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            height: 25,
                            borderBottom: `1px solid ${C.border}`,
                            borderRadius: 4,
                            animationName: i === 0 ? 'cav-row' : undefined,
                        }}
                    >
                        <T size={9} style={{ flex: 1 }}>
                            {label}
                        </T>
                        <span style={{ width: 40, display: 'flex', justifyContent: 'center' }}>
                            <Toggle on={mail} />
                        </span>
                        <span style={{ width: 40, display: 'flex', justifyContent: 'center' }}>
                            <Toggle on={push} />
                        </span>
                    </div>
                ))}
                <T size={8} weight={600} color={C.mutedFg} style={{ display: 'block', marginTop: 8 }}>
                    Resumen diario por correo · a las 7:00
                </T>
            </At>

            {/* Lo que llega */}
            <At
                x={298}
                y={18}
                w={166}
                h={36}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 10,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '0 10px',
                }}
            >
                <span
                    data-a=""
                    style={{
                        position: 'relative',
                        display: 'inline-flex',
                        color: C.mutedFg,
                        animationName: 'cav-shake',
                    }}
                >
                    <Bell size={15} />
                    <span
                        data-a=""
                        style={{
                            position: 'absolute',
                            right: -5,
                            top: -5,
                            minWidth: 13,
                            height: 13,
                            borderRadius: 99,
                            background: C.destructive,
                            color: '#fff',
                            fontSize: 7.5,
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            animationName: 'cav-bell',
                        }}
                    >
                        1
                    </span>
                </span>
                <T size={8.5} weight={600}>
                    Luis te mencionó
                </T>
            </At>
            <At x={298} y={66} w={166} a="cav-mail">
                <div
                    style={{
                        background: C.card,
                        border: `1px solid ${C.border}`,
                        borderRadius: 10,
                        padding: 9,
                        display: 'flex',
                        gap: 7,
                    }}
                >
                    <span
                        style={{
                            width: 22,
                            height: 22,
                            borderRadius: 6,
                            background: primary(0.12),
                            color: primary(),
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        <Mail size={12} />
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <T size={8.5} weight={700}>
                            Luis te mencionó
                        </T>
                        <T size={7.5} color={C.mutedFg}>
                            en «Hotel Brisas»
                        </T>
                    </span>
                </div>
            </At>
            {/* Teléfono */}
            <At
                x={318}
                y={124}
                w={128}
                h={164}
                style={{
                    borderRadius: 20,
                    background: C.muted,
                    border: `5px solid ${C.fg}`,
                    overflow: 'hidden',
                }}
            >
                <div style={{ textAlign: 'center', paddingTop: 12 }}>
                    <T size={18} weight={700}>
                        9:41
                    </T>
                </div>
                <div
                    data-a=""
                    style={{
                        margin: '10px 6px 0',
                        background: C.card,
                        borderRadius: 10,
                        padding: 7,
                        display: 'flex',
                        gap: 6,
                        boxShadow: '0 6px 14px -8px rgba(15,23,42,.4)',
                        animationName: 'cav-push',
                    }}
                >
                    <span
                        style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            background: tone('violet'),
                            color: '#fff',
                            display: 'inline-flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        <AtSign size={11} />
                    </span>
                    <span
                        style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 1,
                            minWidth: 0,
                        }}
                    >
                        <T size={7.5} weight={700}>
                            Luis te mencionó
                        </T>
                        <T size={7} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            «¿Puedes llamar al cliente hoy?»
                        </T>
                    </span>
                </div>
                <span
                    style={{
                        position: 'absolute',
                        bottom: 8,
                        left: 0,
                        right: 0,
                        display: 'flex',
                        justifyContent: 'center',
                        color: C.mutedFg,
                    }}
                >
                    <Smartphone size={10} />
                </span>
            </At>
        </Stage>
    );
}
