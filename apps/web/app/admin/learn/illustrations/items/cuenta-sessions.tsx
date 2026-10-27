import { Laptop, LogOut, Monitor, Smartphone, Tablet } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Dispositivos conectados: se ve dónde está abierta la cuenta y, con
 * «Cerrar las demás», se cierran todas las sesiones menos la de este equipo.
 */

const CSS = `
@keyframes css-cursor{0%{transform:translate(300px,290px);opacity:0}8%{opacity:1}26%,32%{transform:translate(392px,50px)}52%,88%{transform:translate(436px,124px);opacity:1}95%,100%{opacity:0;transform:translate(436px,124px)}}
@keyframes css-ring{0%,28%{opacity:0;transform:scale(.4)}30%{opacity:1;transform:scale(1)}34%,100%{opacity:0;transform:scale(1.6)}}
@keyframes css-out{0%,32%{opacity:1;transform:translateX(0)}42%,90%{opacity:0;transform:translateX(24px)}97%,100%{opacity:1;transform:translateX(0)}}
@keyframes css-toast{0%,40%{opacity:0;transform:translateY(8px)}48%,88%{opacity:1;transform:translateY(0)}95%,100%{opacity:0}}
@keyframes css-warn{0%,30%{background:${tone('amber', 0.1)}}36%,100%{background:transparent}}
`;

function Device({
    icon,
    name,
    where,
    last,
    me,
    a,
    warn,
}: {
    icon: JSX.Element;
    name: string;
    where: string;
    last: string;
    me?: boolean;
    a?: string;
    warn?: boolean;
}): JSX.Element {
    return (
        <div
            data-a={a ? '' : undefined}
            style={{
                height: 46,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '0 10px',
                borderBottom: `1px solid ${C.border}`,
                animationName: a,
                opacity: a ? 0 : 1,
            }}
        >
            <span
                data-a={warn ? '' : undefined}
                style={{
                    width: 30,
                    height: 30,
                    borderRadius: 8,
                    background: me ? primary(0.12) : C.muted,
                    color: me ? primary() : C.mutedFg,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}
            >
                {icon}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <T size={10} weight={600}>
                        {name}
                    </T>
                    {me && (
                        <span
                            style={{
                                height: 15,
                                padding: '0 6px',
                                borderRadius: 99,
                                background: 'hsl(var(--imcrm-success) / .14)',
                                color: C.success,
                                fontSize: 7.5,
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                            }}
                        >
                            este dispositivo
                        </span>
                    )}
                    {warn && (
                        <span
                            style={{
                                height: 15,
                                padding: '0 6px',
                                borderRadius: 99,
                                background: tone('amber', 0.16),
                                color: tone('amber'),
                                fontSize: 7.5,
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                            }}
                        >
                            ¿no lo reconoces?
                        </span>
                    )}
                </span>
                <T size={8} color={C.mutedFg}>
                    {where} · última actividad {last}
                </T>
            </span>
            {!me && (
                <span
                    style={{
                        height: 20,
                        padding: '0 8px',
                        borderRadius: 6,
                        border: `1px solid ${C.border}`,
                        fontSize: 8.5,
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                    }}
                >
                    Cerrar
                </span>
            )}
        </div>
    );
}

export default function CuentaSessions(): JSX.Element {
    return (
        <Stage
            label="En Ajustes, Seguridad, la lista de dispositivos conectados muestra dónde está abierta tu cuenta. Con «Cerrar las demás» se cierran todas las sesiones menos la de este dispositivo."
            tint="blue"
        >
            <Keyframes css={CSS} />
            <At
                x={16}
                y={20}
                w={448}
                h={260}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.4)',
                    overflow: 'hidden',
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 14px 8px',
                    }}
                >
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <T size={11.5} weight={700}>
                            Dispositivos conectados
                        </T>
                        <T size={8.5} color={C.mutedFg}>
                            Si ves algo que no reconoces, ciérralo y cambia la contraseña.
                        </T>
                    </span>
                    <span
                        style={{
                            height: 24,
                            padding: '0 10px',
                            borderRadius: 6,
                            border: `1px solid ${C.border}`,
                            fontSize: 9.5,
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                        }}
                    >
                        <LogOut size={11} /> Cerrar las demás
                    </span>
                </div>
                <div style={{ borderTop: `1px solid ${C.border}` }}>
                    <Device icon={<Laptop size={15} />} name="Chrome · Windows" where="Bogotá, 190.24.x.x" last="ahora" me />
                    <Device icon={<Smartphone size={15} />} name="Safari · iPhone" where="Bogotá, 181.52.x.x" last="hace 2 horas" a="css-out" />
                    <Device icon={<Tablet size={15} />} name="Chrome · Android" where="Cali, 186.30.x.x" last="hace 3 días" a="css-out" />
                    <Device icon={<Monitor size={15} />} name="Firefox · Linux" where="Lima, 200.48.x.x" last="hace 9 días" a="css-out" warn />
                </div>
            </At>
            <At x={16} y={236} w={448} a="css-toast" style={{ display: 'flex', justifyContent: 'center' }}>
                <span
                    style={{
                        height: 30,
                        padding: '0 14px',
                        borderRadius: 9,
                        background: C.fg,
                        color: C.card,
                        fontSize: 9.5,
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        boxShadow: '0 12px 24px -12px rgba(15,23,42,.6)',
                    }}
                >
                    Sesiones cerradas: 3. Esta sigue abierta.
                </span>
            </At>
            <Cursor a="css-cursor" click="css-ring" rest={[436, 124]} />
        </Stage>
    );
}
