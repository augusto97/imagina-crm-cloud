import { Smile } from 'lucide-react';

import { At, Bar, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/**
 * v0.1.369 — «Con su tarjeta» o «Sin marco» al insertar el formulario: la
 * persona toca «Sin marco» y el formulario pierde su fondo, su borde y su
 * espacio alrededor; los campos llegan al borde del hueco que le da la página.
 */

const CSS = `
@keyframes feb-cur{0%,8%{transform:translate(40px,280px)}22%,30%{transform:translate(228px,271px)}62%,70%{transform:translate(138px,271px)}90%,100%{transform:translate(40px,280px)}}
@keyframes feb-ring{0%,23%{opacity:0;transform:scale(.4)}25%{opacity:1;transform:scale(1)}31%,63%{opacity:0;transform:scale(1.6)}65%{opacity:1;transform:scale(1)}71%,100%{opacity:0;transform:scale(1.6)}}
@keyframes feb-card{0%,26%{opacity:1}32%,64%{opacity:0}70%,100%{opacity:1}}
@keyframes feb-bare{0%,26%{opacity:0}32%,64%{opacity:1}70%,100%{opacity:0}}
@keyframes feb-on-card{0%,26%{background:var(--feb-on);color:#fff}32%,64%{background:transparent;color:inherit}70%,100%{background:var(--feb-on);color:#fff}}
@keyframes feb-on-bare{0%,26%{background:transparent;color:inherit}32%,64%{background:var(--feb-on);color:#fff}70%,100%{background:transparent;color:inherit}}
`;

function Field({ label, w, tall }: { label: string; w: number; tall?: boolean }): JSX.Element {
    return (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <T size={6.8} weight={600}>
                {label}
            </T>
            <span style={{ width: w, height: tall ? 30 : 15, borderRadius: 4, border: `1px solid ${C.border}`, background: C.card }} />
        </span>
    );
}

function FormBody({ w }: { w: number }): JSX.Element {
    return (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <T size={10} weight={800}>
                Escríbenos
            </T>
            <Field label="Nombre" w={w} />
            <Field label="Correo" w={w} />
            <Field label="Mensaje" w={w} tall />
            <span style={{ alignSelf: 'flex-start', padding: '4px 10px', borderRadius: 5, background: primary(), color: C.primaryFg }}>
                <T size={7.5} weight={700} color={C.primaryFg}>
                    Enviar
                </T>
            </span>
        </span>
    );
}

export default function FormEmbedBare(): JSX.Element {
    const SLOT = { x: 150, y: 40, w: 150, h: 196 };
    return (
        <Stage label="El formulario insertado en la página de contacto: con su tarjeta trae fondo, borde y espacio; sin marco ocupa exactamente el hueco de la página, sin fondo ni espacio alrededor." tint="amber" cycle={8}>
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2, ['--feb-on' as string]: primary() }}>
                <Win x={92} y={14} w={310} h={240} title="tusitio.com/contacto">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: 16, height: 16, borderRadius: 5, background: tone('amber'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Smile size={10} />
                        </span>
                        <T size={8.5} weight={800}>
                            Tu empresa
                        </T>
                    </div>
                    <At x={12} y={44} w={120} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <T size={12} weight={800} style={{ whiteSpace: 'normal', lineHeight: 1.15 }}>
                            Contáctanos
                        </T>
                        <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Te respondemos en el día.
                        </T>
                        <Bar w={100} h={5} />
                        <Bar w={84} h={5} />
                    </At>
                    {/* El hueco que le da la página */}
                    <At x={SLOT.x} y={SLOT.y} w={SLOT.w} h={SLOT.h} style={{ outline: `1px dashed ${tone('blue', 0.7)}`, outlineOffset: 0 }} />
                    {/* Con su tarjeta: fondo, borde, sombra y espacio */}
                    <At x={SLOT.x} y={SLOT.y} w={SLOT.w} h={SLOT.h} a="feb-card" style={{ background: C.muted, padding: 8 }}>
                        <span style={{ display: 'block', borderRadius: 9, border: `1px solid ${C.border}`, background: C.card, padding: 9, boxShadow: '0 8px 18px -12px rgba(15,23,42,.45)' }}>
                            <FormBody w={98} />
                        </span>
                    </At>
                    {/* Sin marco: los campos al borde del hueco */}
                    <At x={SLOT.x} y={SLOT.y} w={SLOT.w} h={SLOT.h} a="feb-bare" style={{ opacity: 0 }}>
                        <FormBody w={SLOT.w} />
                    </At>
                </Win>

                {/* La elección */}
                <At x={92} y={258} w={180} h={26} style={{ display: 'flex', gap: 4, padding: 3, borderRadius: 8, border: `1px solid ${C.border}`, background: C.card }}>
                    <span data-a="" style={{ flex: 1, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', animationName: 'feb-on-card' }}>
                        <T size={7.5} weight={700} color="inherit">
                            Con su tarjeta
                        </T>
                    </span>
                    <span data-a="" style={{ flex: 1, borderRadius: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', animationName: 'feb-on-bare' }}>
                        <T size={7.5} weight={700} color="inherit">
                            Sin marco
                        </T>
                    </span>
                </At>

                <Cursor a="feb-cur" click="feb-ring" rest={[40, 280]} />
            </At>
        </Stage>
    );
}
