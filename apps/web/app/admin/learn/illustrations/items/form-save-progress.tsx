import { Mail } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Guardar el avance (v0.1.358): la persona deja el formulario a medias,
 * pide el enlace por correo y al abrirlo sigue donde lo dejó, con lo que ya
 * había escrito.
 */

const CSS = `
@keyframes fsp-cur{
0%{transform:translate(200px,280px)}
10%,14%{transform:translate(82px,246px)}
26%,30%{transform:translate(266px,240px)}
48%,52%{transform:translate(380px,200px)}
70%{transform:translate(420px,280px)}
100%{transform:translate(200px,280px)}}
@keyframes fsp-ring{
0%,12%{opacity:0;transform:scale(.4)}13%{opacity:1;transform:scale(1)}18%,27%{opacity:0;transform:scale(1.6)}
28%{opacity:1;transform:scale(1)}33%,49%{opacity:0;transform:scale(1.6)}50%{opacity:1;transform:scale(1)}55%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fsp-box{0%,13%{opacity:0;transform:translateY(-4px)}17%,40%{opacity:1;transform:none}44%,100%{opacity:0}}
@keyframes fsp-mail{0%,30%{opacity:0;transform:translateX(16px) scale(.96)}38%,58%{opacity:1;transform:none}63%,100%{opacity:0}}
@keyframes fsp-form{0%,40%{opacity:1}44%,56%{opacity:.25}60%,100%{opacity:1}}
@keyframes fsp-resume{0%,54%{opacity:0;transform:translateY(-6px)}60%,94%{opacity:1;transform:none}99%,100%{opacity:0}}
`;

const CARD = { background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, boxShadow: '0 12px 30px -14px rgba(15,23,42,.35)' } as const;
const INPUT = { borderRadius: 6, border: `1px solid ${C.border}`, background: C.card, display: 'flex', alignItems: 'center', padding: '0 8px' } as const;

export default function FormSaveProgress(): JSX.Element {
    return (
        <Stage
            label="Guardar el avance: la persona toca «Guardar y seguir después», escribe su correo, le llega un enlace y al abrirlo sigue en el paso donde quedó, con lo que ya había respondido."
            cycle={10}
            tint="amber"
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                <At x={20} y={26} w={260} h={248} a="fsp-form" style={CARD}>
                    <At x={14} y={12}>
                        <T size={7} weight={700} color={C.mutedFg} style={{ letterSpacing: '.05em' }}>
                            PASO 2 DE 4
                        </T>
                    </At>
                    <At x={14} y={26} w={232} h={4} style={{ borderRadius: 99, background: C.muted, overflow: 'hidden' }}>
                        <At x={0} y={0} w={116} h={4} style={{ background: primary(), borderRadius: 99 }} />
                    </At>

                    {/* Aviso al volver */}
                    <At x={14} y={38} w={232} h={26} a="fsp-resume" style={{ opacity: 0, borderRadius: 6, background: tone('amber', 0.16), display: 'flex', alignItems: 'center', padding: '0 8px' }}>
                        <T size={7.5} weight={600}>
                            Retomaste tus respuestas guardadas
                        </T>
                    </At>

                    <At x={14} y={74}>
                        <T size={8} weight={700}>
                            Tu nombre
                        </T>
                    </At>
                    <At x={14} y={86} w={232} h={22} style={INPUT}>
                        <T size={8}>Laura Gómez</T>
                    </At>
                    <At x={14} y={118}>
                        <T size={8} weight={700}>
                            ¿Qué necesitas?
                        </T>
                    </At>
                    <At x={14} y={130} w={232} h={44} style={{ ...INPUT, alignItems: 'flex-start', paddingTop: 6 }}>
                        <T size={8}>Remodelar la cocina…</T>
                    </At>
                    <At x={14} y={186} w={110} h={24} style={{ borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={8} weight={700} color="#fff">
                            Siguiente
                        </T>
                    </At>
                    <At x={14} y={218}>
                        <T size={7.5} weight={600} color={primary()} style={{ textDecoration: 'underline' }}>
                            Guardar y seguir después
                        </T>
                    </At>
                </At>

                {/* El correo para el enlace */}
                <At x={148} y={210} w={150} h={54} a="fsp-box" style={{ ...CARD, opacity: 0, padding: 0 }}>
                    <At x={8} y={7}>
                        <T size={7} weight={700}>
                            Te mandamos el enlace
                        </T>
                    </At>
                    <At x={8} y={22} w={88} h={22} style={INPUT}>
                        <T size={7}>laura@correo.com</T>
                    </At>
                    <At x={100} y={22} w={42} h={22} style={{ borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={7} weight={700} color="#fff">
                            Enviar
                        </T>
                    </At>
                </At>

                {/* El correo que llega */}
                <At x={300} y={112} w={164} h={120} a="fsp-mail" style={{ ...CARD, opacity: 0 }}>
                    <At x={12} y={12} w={24} h={24} style={{ borderRadius: 99, background: primary(0.14), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Mail size={13} color={primary()} />
                    </At>
                    <At x={42} y={14}>
                        <T size={7.5} weight={700}>
                            Sigue con «Cotización»
                        </T>
                    </At>
                    <At x={42} y={25}>
                        <T size={7.5} weight={700}>
                            cuando quieras
                        </T>
                    </At>
                    <At x={12} y={48} w={140} style={{ whiteSpace: 'normal' }}>
                        <T size={6.8} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Tus respuestas quedan guardadas 30 días.
                        </T>
                    </At>
                    <At x={12} y={78} w={140} h={26} style={{ borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={7.5} weight={700} color="#fff">
                            Seguir respondiendo
                        </T>
                    </At>
                </At>

                <Cursor a="fsp-cur" click="fsp-ring" rest={[200, 280]} />
            </At>
        </Stage>
    );
}
