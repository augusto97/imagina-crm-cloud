import { HardDrive, Mail, ServerCrash } from 'lucide-react';

import { At, C, Keyframes, Pill, Stage, T, primary, tone } from '../kit';

/**
 * Diagnóstico: cada correo que intenta salir queda anotado con su resultado
 * (enviado, no enviado o falló y por qué), los errores del servidor se
 * agrupan, y la tarjeta Disco libera espacio con un botón.
 */

const CSS = `
@keyframes pdg-r1{0%,4%{opacity:0;transform:translateY(-6px)}10%,100%{opacity:1;transform:translateY(0)}}
@keyframes pdg-r2{0%,16%{opacity:0;transform:translateY(-6px)}22%,100%{opacity:1;transform:translateY(0)}}
@keyframes pdg-r3{0%,28%{opacity:0;transform:translateY(-6px)}34%,100%{opacity:1;transform:translateY(0)}}
@keyframes pdg-r4{0%,40%{opacity:0;transform:translateY(-6px)}46%,100%{opacity:1;transform:translateY(0)}}
@keyframes pdg-disk{0%,58%{width:86%;background:${tone('amber')}}70%,92%{width:58%;background:${primary()}}100%{width:86%;background:${tone('amber')}}}
@keyframes pdg-d1{0%,62%{opacity:1}68%,92%{opacity:0}100%{opacity:1}}
@keyframes pdg-d2{0%,62%{opacity:0}68%,92%{opacity:1}100%{opacity:0}}
@keyframes pdg-btn{0%,54%{transform:scale(1)}57%{transform:scale(.94)}60%,100%{transform:scale(1)}}
`;

function MailRow({ a, to, subj, via, state }: { a: string; to: string; subj: string; via: string; state: JSX.Element }): JSX.Element {
    return (
        <div
            data-a=""
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                height: 34,
                padding: '0 10px',
                borderTop: `1px solid ${C.border}`,
                animationName: a,
            }}
        >
            <Mail size={12} color={C.mutedFg} />
            <span
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                    flex: 1,
                    minWidth: 0,
                }}
            >
                <T size={8.5} weight={600}>
                    {subj}
                </T>
                <T size={7.5} color={C.mutedFg}>
                    Para {to} · {via}
                </T>
            </span>
            {state}
        </div>
    );
}

export default function PlatDiagnostics(): JSX.Element {
    return (
        <Stage
            label="En Diagnóstico se ve cada correo que el servidor intentó mandar con su resultado (enviado, no enviado o falló y por qué) y los errores del servidor agrupados. La tarjeta Disco muestra el espacio y libera lo que sobra con un botón."
            tint="rose"
        >
            <Keyframes css={CSS} />
            <At
                x={14}
                y={30}
                w={282}
                h={240}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    overflow: 'hidden',
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.45)',
                }}
            >
                <div
                    style={{
                        padding: '9px 10px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 2,
                    }}
                >
                    <T size={10.5} weight={700}>
                        Correos recientes
                    </T>
                    <T size={8} color={C.mutedFg}>
                        Cada intento, con por dónde salió y qué pasó.
                    </T>
                </div>
                <MailRow
                    a="pdg-r1"
                    subj="Te invitaron a «Clínica Norte»"
                    to="lucia@clinicanorte.co"
                    via="Correo de cuenta"
                    state={<Pill t="mint" label="Enviado" />}
                />
                <MailRow a="pdg-r2" subj="Restablece tu contraseña" to="mateo@correo.co" via="Correo de cuenta" state={<Pill t="mint" label="Enviado" />} />
                <MailRow
                    a="pdg-r3"
                    subj="Recordatorio de pago FAC-1042"
                    to="ana@hotelbrisas.co"
                    via="SMTP de la empresa"
                    state={<Pill t="rose" label="Falló" />}
                />
                <MailRow
                    a="pdg-r4"
                    subj="Confirma tu correo"
                    to="pedro@agencia.co"
                    via="sin correo configurado"
                    state={<Pill t="amber" label="No enviado" />}
                />
                <div
                    style={{
                        padding: '8px 10px',
                        borderTop: `1px solid ${C.border}`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                    }}
                >
                    <ServerCrash size={12} color={C.destructive} />
                    <T size={8.5} weight={600}>
                        Errores del servidor
                    </T>
                    <T size={8} color={C.mutedFg}>
                        · 2 agrupados (3 veces, última hace 1 hora)
                    </T>
                </div>
            </At>

            {/* Disco */}
            <At
                x={308}
                y={30}
                w={158}
                h={240}
                style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: 11,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 9,
                    boxShadow: '0 12px 30px -16px rgba(15,23,42,.45)',
                }}
            >
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <HardDrive size={13} color={primary()} />
                    <T size={10.5} weight={700}>
                        Disco
                    </T>
                </span>
                <span style={{ position: 'relative', height: 26, display: 'block' }}>
                    <span
                        data-a=""
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 1,
                            opacity: 0,
                            animationName: 'pdg-d1',
                        }}
                    >
                        <T size={8.5} weight={700} color={tone('amber')}>
                            Queda poco · 86 % usado
                        </T>
                        <T size={7.5} color={C.mutedFg}>
                            5,6 GB libres de 40 GB
                        </T>
                    </span>
                    <span
                        data-a=""
                        style={{
                            position: 'absolute',
                            left: 0,
                            top: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 1,
                            animationName: 'pdg-d2',
                        }}
                    >
                        <T size={8.5} weight={700} color={C.success}>
                            Bien · 58 % usado
                        </T>
                        <T size={7.5} color={C.mutedFg}>
                            16,8 GB libres de 40 GB
                        </T>
                    </span>
                </span>
                <span
                    style={{
                        height: 8,
                        borderRadius: 99,
                        background: C.muted,
                        overflow: 'hidden',
                    }}
                >
                    <span
                        data-a=""
                        style={{
                            display: 'block',
                            height: '100%',
                            width: '58%',
                            background: primary(),
                            animationName: 'pdg-disk',
                        }}
                    />
                </span>
                <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal', lineHeight: 1.4 }}>
                    Se pueden liberar versiones viejas de la app y copias previas a cada actualización. No toca los datos de tus clientes.
                </T>
                <span
                    data-a=""
                    style={{
                        alignSelf: 'flex-start',
                        height: 22,
                        padding: '0 10px',
                        borderRadius: 6,
                        background: primary(),
                        color: C.primaryFg,
                        fontSize: 9,
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        animationName: 'pdg-btn',
                    }}
                >
                    Liberar espacio
                </span>
            </At>
        </Stage>
    );
}
