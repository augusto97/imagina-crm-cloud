import { Check, Code2, Copy, Link2, ShieldCheck, Smile } from 'lucide-react';

import { At, Bar, C, Cursor, Keyframes, Stage, T, Win, primary, tone } from '../kit';

/** Insertar el formulario: se copia el código de «Insertar en tu sitio» y el formulario aparece dentro de la página web. */

const CSS = `
@keyframes fe-cursor{0%{transform:translate(120px,280px);opacity:0}6%{opacity:1}18%,24%{transform:translate(134px,190px);opacity:1}36%,100%{transform:translate(134px,190px);opacity:0}}
@keyframes fe-ring{0%,19%{opacity:0;transform:scale(.4)}21%{opacity:1;transform:scale(1)}25%,100%{opacity:0;transform:scale(1.6)}}
@keyframes fe-copy{0%,21%{opacity:1}24%,94%{opacity:0}100%{opacity:1}}
@keyframes fe-copied{0%,21%{opacity:0}24%,92%{opacity:1}97%,100%{opacity:0}}
@keyframes fe-fly{0%,26%{opacity:0;transform:translate(0,0) scale(.7)}30%{opacity:1;transform:translate(0,0) scale(1)}44%{opacity:1;transform:translate(176px,-40px) scale(1)}48%,100%{opacity:0;transform:translate(176px,-40px) scale(.7)}}
@keyframes fe-slot{0%,44%{opacity:1}52%,94%{opacity:0}100%{opacity:1}}
@keyframes fe-form{0%,46%{opacity:0;transform:translateY(10px)}54%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
@keyframes fe-ok{0%,58%{opacity:0;transform:translateY(6px)}64%,92%{opacity:1;transform:translateY(0)}97%,100%{opacity:0}}
`;

export default function FormEmbed(): JSX.Element {
    return (
        <Stage label="Se copia el código de Insertar en tu sitio desde el panel Compartir y el formulario aparece dentro de la página web de la empresa, que está en la lista de sitios permitidos." tint="blue">
            <Keyframes css={CSS} />
            <At x={0} y={0} w={480} h={300} style={{ fontSize: 9, lineHeight: 1.2 }}>
                {/* Panel Compartir */}
                <At
                    x={16}
                    y={66}
                    w={150}
                    h={160}
                    style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, padding: 11, display: 'flex', flexDirection: 'column', gap: 8, boxShadow: '0 12px 30px -14px rgba(15,23,42,.4)', zIndex: 3 }}
                >
                    <T size={9} weight={800}>
                        Compartir el formulario
                    </T>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={7} weight={600} color={C.mutedFg}>
                            Enlace
                        </T>
                        <span style={{ display: 'flex', gap: 4 }}>
                            <span style={{ flex: 1, height: 17, borderRadius: 4, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: 3, padding: '0 4px', overflow: 'hidden' }}>
                                <Link2 size={8} color={C.mutedFg} />
                                <T size={6.5} color={C.mutedFg} style={{ fontFamily: 'ui-monospace, monospace' }}>
                                    …/public/f/k3t9w2
                                </T>
                            </span>
                            <span style={{ width: 17, height: 17, borderRadius: 4, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Copy size={8} />
                            </span>
                        </span>
                    </span>
                    <span style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                        <T size={7} weight={600} color={C.mutedFg}>
                            Insertar en tu sitio
                        </T>
                        <span style={{ borderRadius: 4, border: `1px solid ${C.border}`, background: C.muted, padding: '4px 5px' }}>
                            <T size={6.5} style={{ fontFamily: 'ui-monospace, monospace', whiteSpace: 'normal', wordBreak: 'break-all' }}>
                                {'<iframe src="https://…/f/k3t9w2" width="100%" height="640">'}
                            </T>
                        </span>
                        <span style={{ position: 'relative', alignSelf: 'flex-end', width: 62, height: 18 }}>
                            <span data-a="" style={{ position: 'absolute', inset: 0, borderRadius: 4, border: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, opacity: 0, animationName: 'fe-copy' }}>
                                <Copy size={8} />
                                <T size={7.5} weight={600}>
                                    Copiar
                                </T>
                            </span>
                            <span data-a="" style={{ position: 'absolute', inset: 0, borderRadius: 4, border: `1px solid ${tone('mint', 0.5)}`, background: tone('mint', 0.12), display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, animationName: 'fe-copied' }}>
                                <Check size={8} color={tone('mint')} />
                                <T size={7.5} weight={600} color={tone('mint')}>
                                    Copiado
                                </T>
                            </span>
                        </span>
                    </span>
                </At>
                {/* El código que viaja */}
                <At x={112} y={176} a="fe-fly" style={{ opacity: 0, zIndex: 9 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 7, background: primary(), color: C.primaryFg, boxShadow: `0 8px 18px -6px ${primary(0.6)}` }}>
                        <Code2 size={10} />
                        <T size={7.5} weight={700} color={C.primaryFg}>
                            {'<iframe>'}
                        </T>
                    </span>
                </At>

                {/* El sitio web */}
                <Win x={178} y={22} w={286} h={256} title="sonrisaclara.com">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderBottom: `1px solid ${C.border}` }}>
                        <span style={{ width: 16, height: 16, borderRadius: 5, background: tone('cyan'), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Smile size={10} />
                        </span>
                        <T size={8.5} weight={800}>
                            Sonrisa Clara
                        </T>
                        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                            {['Servicios', 'Equipo', 'Contacto'].map((l) => (
                                <T key={l} size={7} color={C.mutedFg}>
                                    {l}
                                </T>
                            ))}
                        </span>
                    </div>
                    <At x={12} y={42} w={112} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <T size={12} weight={800} style={{ whiteSpace: 'normal', lineHeight: 1.15 }}>
                            Tu valoración dental gratis
                        </T>
                        <T size={7.5} color={C.mutedFg} style={{ whiteSpace: 'normal' }}>
                            Déjanos tus datos y te llamamos para agendar.
                        </T>
                        <Bar w={96} h={5} />
                        <Bar w={80} h={5} />
                        <Bar w={88} h={5} />
                    </At>
                    {/* Hueco del formulario */}
                    <At x={134} y={38} w={140} h={184} a="fe-slot" style={{ opacity: 0, borderRadius: 9, border: `1.5px dashed ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <T size={7.5} color={C.mutedFg}>
                            Pega aquí el código
                        </T>
                    </At>
                    {/* El formulario insertado */}
                    <At x={134} y={38} w={140} h={184} a="fe-form" style={{ borderRadius: 9, border: `1px solid ${C.border}`, overflow: 'hidden', background: C.card, boxShadow: '0 8px 20px -12px rgba(15,23,42,.4)' }}>
                        <div style={{ height: 3, background: tone('cyan') }} />
                        <div style={{ padding: 9, display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <T size={9} weight={800}>
                                Pide tu valoración
                            </T>
                            {['Nombre', 'Celular', '¿Qué te preocupa?'].map((l) => (
                                <span key={l} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    <T size={7} weight={700}>
                                        {l}
                                    </T>
                                    <span style={{ height: 15, borderRadius: 4, border: `1px solid ${C.border}` }} />
                                </span>
                            ))}
                            <span style={{ marginTop: 2, height: 19, borderRadius: 5, background: tone('cyan'), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <T size={8} weight={700} color="#fff">
                                    Enviar
                                </T>
                            </span>
                        </div>
                    </At>
                </Win>
                <At x={196} y={250} a="fe-ok" style={{ zIndex: 4 }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 99, background: C.card, border: `1px solid ${C.border}`, boxShadow: '0 8px 18px -8px rgba(15,23,42,.4)' }}>
                        <ShieldCheck size={10} color={tone('mint')} />
                        <T size={7.5} weight={700}>
                            Sitios que pueden insertarlo: sonrisaclara.com
                        </T>
                    </span>
                </At>
                <Cursor a="fe-cursor" click="fe-ring" rest={[134, 190]} />
            </At>
        </Stage>
    );
}
