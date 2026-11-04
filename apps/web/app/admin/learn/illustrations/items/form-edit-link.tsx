import { Check, MessageCircle } from 'lucide-react';

import { At, C, Cursor, Keyframes, Stage, T, primary, tone } from '../kit';

/**
 * Enlace para actualizar un registro (v0.1.360): llega un mensaje con el
 * enlace, el formulario abre con los datos ya puestos, la persona corrige uno
 * y el registro de la lista queda al día (sin crear otro).
 */

const CSS = `
@keyframes fel-cur{
0%{transform:translate(120px,270px)}
10%,14%{transform:translate(118px,118px)}
34%,38%{transform:translate(330px,150px)}
56%,60%{transform:translate(330px,226px)}
78%,100%{transform:translate(120px,270px)}}
@keyframes fel-ring{0%,11%{opacity:0;transform:scale(.4)}12%{opacity:1;transform:scale(1)}17%,35%{opacity:0;transform:scale(1.6)}36%{opacity:1;transform:scale(1)}41%,57%{opacity:0;transform:scale(1.6)}58%{opacity:1;transform:scale(1)}63%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fel-form{0%,13%{opacity:0;transform:translateY(8px)}18%,92%{opacity:1;transform:none}97%,100%{opacity:0}}
@keyframes fel-old{0%,37%{opacity:1}40%,100%{opacity:0}}
@keyframes fel-new{0%,38%{opacity:0}42%,100%{opacity:1}}
@keyframes fel-done{0%,59%{opacity:0;transform:scale(.92)}64%,92%{opacity:1;transform:none}97%,100%{opacity:0}}
@keyframes fel-rec{0%,63%{opacity:0}68%,92%{opacity:1}97%,100%{opacity:0}}
`;

const CARD = { background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, boxShadow: '0 10px 26px -14px rgba(15,23,42,.35)' } as const;

export default function FormEditLink(): JSX.Element {
    return (
        <Stage
            label="Enlace para actualizar: al cliente le llega un mensaje con un enlace, el formulario abre con sus datos ya puestos, corrige su correo y su registro queda actualizado sin crear otro."
            cycle={9}
            tint="mint"
        >
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* El mensaje que le llega */}
                <At x={18} y={40} w={180} h={120} style={{ ...CARD, padding: 0 }}>
                    <At x={10} y={10} w={22} h={22} style={{ borderRadius: 99, background: tone('mint', 0.18), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <MessageCircle size={12} color={tone('mint')} />
                    </At>
                    <At x={40} y={12}>
                        <T size={8} weight={700}>
                            Constructora Andina
                        </T>
                    </At>
                    <At x={40} y={24}>
                        <T size={6.5} color={C.mutedFg}>
                            hace un momento
                        </T>
                    </At>
                    <At x={10} y={44} w={160}>
                        <T size={7.2}>Hola, Ana. ¿Tus datos siguen al día? Revísalos aquí:</T>
                    </At>
                    <At x={10} y={74} w={160} h={22} style={{ borderRadius: 6, background: primary(0.1), display: 'flex', alignItems: 'center', padding: '0 8px' }}>
                        <T size={7} weight={700} color={primary()}>
                            Actualizar mis datos
                        </T>
                    </At>
                </At>

                {/* El formulario con sus datos ya puestos */}
                <At x={220} y={30} w={242} h={240} a="fel-form" style={{ ...CARD, opacity: 0 }}>
                    <At x={14} y={12} w={214} h={4} style={{ borderRadius: 99, background: primary() }} />
                    <At x={14} y={24}>
                        <T size={9} weight={800}>
                            Actualiza tus datos
                        </T>
                    </At>
                    <At x={14} y={40} w={214} h={20} style={{ borderRadius: 5, background: C.muted, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                        <T size={6.5} color={C.mutedFg}>
                            Estás actualizando tus datos.
                        </T>
                    </At>
                    <At x={14} y={70}>
                        <T size={7} weight={600}>
                            Nombre
                        </T>
                        <At x={0} y={11} w={214} h={20} style={{ borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                            <T size={7}>Ana Gómez</T>
                        </At>
                    </At>
                    <At x={14} y={108}>
                        <T size={7} weight={600}>
                            Correo
                        </T>
                        <At x={0} y={11} w={214} h={20} style={{ borderRadius: 5, border: `1px solid ${primary(0.6)}`, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                            <At x={7} y={6} a="fel-old">
                                <T size={7}>ana@correo-viejo.com</T>
                            </At>
                            <At x={7} y={6} a="fel-new" style={{ opacity: 0 }}>
                                <T size={7} weight={600}>
                                    ana.gomez@andina.co
                                </T>
                            </At>
                        </At>
                    </At>
                    <At x={14} y={146}>
                        <T size={7} weight={600}>
                            Teléfono
                        </T>
                        <At x={0} y={11} w={214} h={20} style={{ borderRadius: 5, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', padding: '0 7px' }}>
                            <T size={7}>+57 300 123 4567</T>
                        </At>
                    </At>
                    <At x={14} y={186} w={110} h={24} style={{ borderRadius: 6, background: primary(), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={7.5} weight={700} color="#fff">
                            Guardar cambios
                        </T>
                    </At>
                    {/* ¡Listo! */}
                    <At x={20} y={70} w={202} h={74} a="fel-done" style={{ ...CARD, opacity: 0, display: 'flex', alignItems: 'center' }}>
                        <At x={12} y={22} w={30} h={30} style={{ borderRadius: 99, background: tone('mint', 0.9), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Check size={16} color="#fff" strokeWidth={3} />
                        </At>
                        <At x={52} y={22}>
                            <T size={9} weight={800}>
                                ¡Listo!
                            </T>
                        </At>
                        <At x={52} y={38}>
                            <T size={7} color={C.mutedFg}>
                                Guardamos tus cambios.
                            </T>
                        </At>
                    </At>
                </At>

                {/* El registro en la lista, al día */}
                <At x={18} y={184} w={180} h={86} a="fel-rec" style={{ ...CARD, opacity: 0 }}>
                    <At x={10} y={10}>
                        <T size={6.3} weight={700} color={C.mutedFg} style={{ letterSpacing: '.05em' }}>
                            EN TU LISTA DE CLIENTES
                        </T>
                    </At>
                    <At x={10} y={26}>
                        <T size={8} weight={700}>
                            Ana Gómez
                        </T>
                    </At>
                    <At x={10} y={42}>
                        <T size={7} color={primary()} weight={600}>
                            ana.gomez@andina.co
                        </T>
                    </At>
                    <At x={10} y={60}>
                        <T size={6.5} color={C.mutedFg}>
                            Mismo registro · actualizado ahora
                        </T>
                    </At>
                </At>

                <Cursor a="fel-cur" click="fel-ring" rest={[120, 270]} />
            </At>
        </Stage>
    );
}
